# -*- coding: utf-8 -*-
"""Mooncoda 磁吸孔桥接插件(Mooncoda Magnet Bridge)

网页版(/tools/magnet)的「本地 Blender」那条路靠它。

用法(三种都行):

  A. **装成插件**(推荐 —— 一次装好,以后打开 Blender 就自动起)
     下载网页给的 ``mooncoda_magnet_bridge.zip``,然后
     Blender → Edit → Preferences → Add-ons → Install…(Install from Disk)→
     选那个 zip → 勾上「Mooncoda Magnet Bridge」启用。

     启用之后**桥接自动就起了**(端口在偏好设置里改);要手动开关就点
     3D 视图右侧(N 面板)→ Mooncoda →「启动桥接 / 停止桥接」。

     ⚠️ **那个 zip 是从这个文件构建出来的** —— 内容完全一样,只是包成了
     Blender 认的插件结构(``mooncoda_magnet_bridge/__init__.py`` +
     ``bridge.py``)。改了这份源码要重新构建:
     ``pnpm magnet:addon``。

  B. **直接跑**(临时用一下)
     Blender → Scripting → 新建文本 → 把本文件整个粘进去 → Run Script
     跑完桥接就起了,控制台会打印端口(默认 8765)。

  C. **命令执行(不打开 GUI)** —— 网页给的一键启动脚本走的就是这条
     ``blender --background --factory-startup --python blender_bridge.py``

     ⚠️ **``--background`` 有个坑**:跑完 ``--python`` 脚本 Blender 就退出,
     GUI 的事件循环压根不存在 ⇒ ``bpy.app.timers`` **永远不会触发** ⇒
     作业堆在队列里,网页端只等到一个没头没尾的超时。
     所以后台模式下脚本**自己不返回** —— ``_pump_forever()`` 在主线程里
     轮询队列(跟 GUI 里那个定时器干的是同一件事:跑活必须在主线程,
     bpy 的上下文只能主线程碰)。Ctrl+C 退出。

     图形界面模式(A / B)跟后台模式(C)**两条都能用**,由
     ``bpy.app.background`` 自己分。

它做什么:

  1. 网页版把模型**送到本机**的 ``127.0.0.1:<端口>``(zip:OBJ + MTL + 纹理)
  2. 插件导入 → 修网格(合并重复顶点 / 重算法线)→ 挑**最大的一块平面**
  3. 在那块平面上挖一个圆柱沉孔(EXACT 求解器,失败退 FAST)
  4. 导回 zip(OBJ + MTL + 纹理)给网页版

模型**不出这台电脑** —— 全程只跟 127.0.0.1 说话,没有上传、没有账号。

## 破口怎么办:临时封上,切完原样还给你(2026-11-11)

工作室的原话:**「不需要修复用户的模型,只需要完成磁铁孔」**。

模型不是封闭实体(有开放边 / 非流形边)时,布尔运算需要闭合的实体 ⇒
这里给每条边界环生成一张**临时盖面**,只喂给布尔运算,**切完立刻摘掉**。

⇒ 用户拿到的还是他自己的模型 —— 只是多了一个磁吸孔,破口**还在那儿**。

盖面靠一个**临时材质槽**认出来(``__magnet_lid__``):布尔之后按材质下标
把那些面删掉。跟网页端那套「单独一个 run id」的认法是同一个思路。

跟浏览器那条路(``magnet-lid.ts``)是**同一套数学** ⇒ 两条引擎切出来的
模型,破口处理方式一模一样。

## 为什么挑「最大的一块平面」而不是「六个轴向」

工作室原来那段脚本只在六个轴向里找背面 —— 那个模型在 Blender 里是轴对齐的,
所以背面正好平行于某个轴,看起来像「智能」。模型一歪,六面里就没有背面了。
这里按**面积**找最大的平面区域,跟模型朝向无关。
"""

bl_info = {
    "name": "Mooncoda Magnet Bridge",
    "author": "Mooncoda",
    "version": (1, 1, 0),
    "blender": (3, 0, 0),
    "location": "View3D > Sidebar > Mooncoda",
    "description": "让网页版的磁吸孔切割工具调用本机 Blender 切孔(模型不出这台电脑)",
    "category": "Object",
}

import bpy
import bmesh
import io
import json
import math
import os
import queue
import shutil
import sys
import tempfile
import threading
import time
import traceback
import zipfile

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

#: 协议版本 —— 网页端对不上就回 BLENDER_BAD_RESPONSE
PROTOCOL_VERSION = 1

#: 默认端口(网页端也是这个)
DEFAULT_PORT = 8765

#: 切刀圆周段数 —— 跟网页端 / 工作室脚本一样是 64
CUTTER_SEGMENTS = 64

#: 切刀在面**外面**多伸多少(mm)—— 跟面完全共面时布尔会出退化结果
PENETRATION_MM = 0.5

#: 孔底最少还要剩多少壁厚(mm)
MIN_WALL_MM = 0.3

#: 孔参数默认值(实物磁铁的尺寸)
DEFAULT_HOLE_DIA_MM = 20.7
DEFAULT_HOLE_DEPTH_MM = 1.3

#: 导出的文件名(跟工作室脚本一致)
EXPORT_OBJ_NAME = "relief_final.obj"

#: 切一次最多等多久(秒)
CUT_TIMEOUT_SECONDS = 900

#: 平面聚类的法线容差(度)—— 超过这个角度就不算同一块平面
FLAT_CLUSTER_TOLERANCE_DEG = 20.0

#: 临时盖面用的材质槽名字 —— 布尔之后靠它把盖面从结果里摘掉
LID_MATERIAL_NAME = "__magnet_lid__"

#: 占位材质槽 —— **没有材质**的模型上,临时槽不能占 0 号(所有面的材质
#: 下标都是 0)⇒ 先垫一个占位槽,临时槽落在 1 号,切完一起撤掉
PLACEHOLDER_MATERIAL_NAME = "__magnet_placeholder__"

#: 临时材质的前缀 —— 切完在用户的 Blender 里一个都不留
TEMP_MATERIAL_PREFIX = "__magnet_"

#: 磁吸孔页面 —— 面板上那颗「打开页面」按钮用它
MAGNET_PAGE_URL = "https://aimake3d.com/zh/tools/magnet"


# ---------------------------------------------------------------------------
# 「我是个插件模块吗?」
# ---------------------------------------------------------------------------
#
# 这份文件有**三种身份**:
#
# - **装成 zip 插件** ⇒ 模块名 ``mooncoda_magnet_bridge.bridge``
#   (包名 + 子模块名)
# - **装成 legacy .py 插件** ⇒ 模块名 ``blender_bridge``
# - **直接跑**(粘到 Text Editor / ``--python``)⇒ ``__main__``
#
# 插件偏好(AddonPreferences)的 ``bl_idname`` 跟模块名对得上,Blender 才能
# 在 ``bpy.context.preferences.addons[<模块名>]`` 里找到它 ——
# 而「直接跑」那种身份压根不在那张表里(所以那边拿不到偏好,端口走默认值)。
def _addon_module_name():
    return (__name__ or "__main__").split(".")[0]


#: 这个模块在 Blender 里的名字(插件偏好按它注册)
ADDON_MODULE = _addon_module_name()

# ---------------------------------------------------------------------------
# 运行期状态
# ---------------------------------------------------------------------------

_jobs = queue.Queue()
_server = None
_server_thread = None
_server_port = None
_timer_registered = False


class BridgeError(Exception):
    """带 code 的错 —— 网页端按 code 说人话"""

    def __init__(self, message, code="CUT_FAILED"):
        Exception.__init__(self, message)
        self.message = message
        self.code = code


# ---------------------------------------------------------------------------
# 主线程里跑活
# ---------------------------------------------------------------------------


def _drain_jobs():
    """在 Blender **主线程**里跑排队中的活。

    bpy 的算子和上下文只能在主线程碰 —— HTTP 线程只负责收活、排队、等结果。
    """
    while True:
        try:
            job = _jobs.get_nowait()
        except queue.Empty:
            break
        try:
            job["result"] = _run_cut(job["payload"])
            job["error"] = None
            job["code"] = None
        except BridgeError as err:
            job["result"] = None
            job["error"] = err.message
            job["code"] = err.code
        except Exception:
            job["result"] = None
            job["error"] = traceback.format_exc()
            job["code"] = "UNEXPECTED"
        finally:
            job["event"].set()
    # 0.2 秒醒一次 —— 空转几乎不花 CPU
    return 0.2


def _ensure_timer():
    global _timer_registered
    if _timer_registered:
        return
    if bpy.app.background:
        # --background 模式下 **事件循环压根不存在** ⇒ 定时器永远不触发
        # ⇒ 作业堆在队列里,HTTP 线程干等到超时。
        # 后台模式改走 _pump_forever()(脚本自己阻塞,在主线程里轮询)。
        return
    try:
        bpy.app.timers.register(_drain_jobs, persistent=True)
        _timer_registered = True
    except Exception:
        print("[Mooncoda] 定时器注册失败:", traceback.format_exc())


def _pump_forever():
    """后台模式(``--background``)下的「主线程泵」。

    **为什么需要这个** —— ``blender --background --python xxx.py`` 跑完脚本就
    退出,GUI 的事件循环压根不存在 ⇒ ``bpy.app.timers`` 永远不触发 ⇒ 作业堆在
    队列里,HTTP 线程干等到 900 秒超时,网页端只看到一个没头没尾的 `BLENDER_TIMEOUT`。

    所以后台模式下**脚本自己不返回**:在主线程里轮询队列,跟 GUI 里那个定时器
    干的是同一件事(跑活必须在主线程 —— bpy 的上下文只能主线程碰)。

    Ctrl+C 退出。
    """
    print("[Mooncoda] 后台模式(无 GUI):在主线程里跑活,Ctrl+C 退出")
    try:
        while True:
            _drain_jobs()
            time.sleep(0.05)
    except KeyboardInterrupt:
        print("[Mooncoda] 收到 Ctrl+C,退出")
    finally:
        stop_bridge()


# ---------------------------------------------------------------------------
# HTTP 服务
# ---------------------------------------------------------------------------


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print("[Mooncoda] " + (fmt % args))

    def _cors(self):
        # 混合内容:127.0.0.1 本身是「可信来源」,不用管
        # 私有网络访问(Chrome PNA):公网页面访问本机地址必须带这个头
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Max-Age", "600")

    def _send(self, status, body, content_type, extra_headers=None):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if path != "/ping":
            self._send_json(404, {"error": "未知路径", "code": "NOT_FOUND"})
            return
        payload = {
            "ok": True,
            "protocol": PROTOCOL_VERSION,
            "blender": bpy.app.version_string,
            "addOn": "%s %s"
            % (bl_info["name"], ".".join(str(x) for x in bl_info["version"])),
        }
        self._send_json(200, payload)

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if path != "/cut":
            self._send_json(404, {"error": "未知路径", "code": "NOT_FOUND"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            params = json.loads(self.headers.get("x-magnet-params") or "{}")
        except Exception:
            self._send_json(
                400, {"error": "孔参数解析不了", "code": "INVALID_PARAMS"}
            )
            return
        if not raw:
            self._send_json(400, {"error": "没收到模型", "code": "NO_PAYLOAD"})
            return

        job = {
            "payload": {"params": params, "zip": raw},
            "event": threading.Event(),
            "result": None,
            "error": None,
            "code": None,
        }
        _jobs.put(job)
        if not job["event"].wait(timeout=CUT_TIMEOUT_SECONDS):
            self._send_json(504, {"error": "Blender 那边超时了", "code": "TIMEOUT"})
            return
        if job["error"]:
            self._send_json(
                500,
                {"error": job["error"], "code": job["code"] or "CUT_FAILED"},
            )
            return
        zip_bytes, stats = job["result"]
        # 头里只能放 ASCII —— JSON 用 ensure_ascii 把中文转义掉
        self._send(
            200,
            zip_bytes,
            "application/zip",
            {"x-magnet-stats": json.dumps(stats, ensure_ascii=True)},
        )


def start_bridge(port=DEFAULT_PORT):
    """起桥接。返回实际用的端口(起不来返回 None)。"""
    global _server, _server_thread, _server_port
    if _server is not None:
        return _server_port
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    except OSError as err:
        print("[Mooncoda] 端口 %d 起不来:%s" % (port, err))
        return None
    _server = httpd
    _server_port = port
    _server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    _server_thread.start()
    _ensure_timer()
    print("[Mooncoda] 桥接已启动:http://127.0.0.1:%d" % port)
    return port


def stop_bridge():
    """停桥接。"""
    global _server, _server_thread, _server_port
    if _server is not None:
        try:
            _server.shutdown()
            _server.server_close()
        except Exception:
            pass
    _server = None
    _server_thread = None
    _server_port = None
    print("[Mooncoda] 桥接已停止")


# ---------------------------------------------------------------------------
# OBJ 解析(我们自己解析 —— 不走 Blender 的导入算子,免得版本差异)
# ---------------------------------------------------------------------------


def _parse_obj(text):
    """OBJ → (顶点, 贴图坐标, 面, mtllib 名)

    面 = (顶点下标列表, 贴图下标列表, 材质名)

    只认常见的那几种写法:``v`` / ``vt`` / ``vn`` / ``f`` / ``usemtl`` /
    ``mtllib``。负下标(相对下标)按 OBJ 规范处理。
    """
    verts = []
    vts = []
    faces = []
    current_material = None
    mtllib = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        key = parts[0]
        if key == "v" and len(parts) >= 4:
            try:
                verts.append(
                    (float(parts[1]), float(parts[2]), float(parts[3]))
                )
            except ValueError:
                continue
        elif key == "vt" and len(parts) >= 3:
            try:
                vts.append((float(parts[1]), float(parts[2])))
            except ValueError:
                vts.append((0.0, 0.0))
        elif key == "usemtl":
            current_material = " ".join(parts[1:]).strip() or None
        elif key == "mtllib":
            mtllib = " ".join(parts[1:]).strip() or None
        elif key == "f" and len(parts) >= 4:
            v_idx = []
            t_idx = []
            for token in parts[1:]:
                bits = token.split("/")
                try:
                    v = int(bits[0])
                except ValueError:
                    continue
                if v < 0:
                    v = len(verts) + v
                v_idx.append(v)
                t = 0
                if len(bits) > 1 and bits[1]:
                    try:
                        t = int(bits[1])
                    except ValueError:
                        t = 0
                    if t < 0:
                        t = len(vts) + t
                t_idx.append(t)
            if len(v_idx) >= 3:
                faces.append((v_idx, t_idx, current_material))

    return verts, vts, faces, mtllib


# ---------------------------------------------------------------------------
# 网格构建 + 修复
# ---------------------------------------------------------------------------


def _build_object(verts, vts, faces, collection):
    """三角汤 → Blender 网格对象(带 UV 和材质分组)"""
    mesh = bpy.data.meshes.new("MooncodaModel")
    obj = bpy.data.objects.new("MooncodaModel", mesh)
    collection.objects.link(obj)

    # 材质槽:按 usemtl 第一次出现的顺序
    slot_names = []
    slot_of = {}
    for _, _, material in faces:
        if material and material not in slot_of:
            slot_of[material] = len(slot_names)
            slot_names.append(material)
    for name in slot_names:
        mesh.materials.append(bpy.data.materials.new(name))

    bm = bmesh.new()
    bm_verts = [bm.verts.new(Vector(v)) for v in verts]
    bm.verts.ensure_lookup_table()
    uv_layer = bm.loops.layers.uv.verify()

    for v_idx, t_idx, material in faces:
        try:
            face_verts = [bm_verts[i - 1] for i in v_idx if 1 <= i <= len(bm_verts)]
        except IndexError:
            continue
        if len(face_verts) < 3:
            continue
        try:
            face = bm.faces.new(face_verts)
        except ValueError:
            # 重复的面 —— 跳过
            continue
        if material and material in slot_of:
            face.material_index = slot_of[material]
        for loop, t in zip(face.loops, t_idx):
            if 1 <= t <= len(vts):
                loop[uv_layer].uv = vts[t - 1]

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj, slot_names


def _model_span(target):
    """模型的尺寸(最大边)—— 网格顶点算的,不看依赖图(那边可能还没更新)"""
    mesh = target.data if hasattr(target, "data") else target
    if not len(mesh.vertices):
        return 1.0
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    zs = [v.co.z for v in mesh.vertices]
    span = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    return span if span > 1e-6 else 1.0


def _repair_mesh(obj):
    """修网格:合并重复顶点 + 重算法线

    AI 生成的模型顶点常常是**裂开**的(同一条边上的顶点差了 1e-6),
    布尔运算对这种输入会直接失败。
    """
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    if len(bm.verts):
        diag = _model_span(mesh)
        # 合并距离跟着模型大小走 —— 0.01mm 级的裂缝要补,更大的缝别乱合
        dist = min(0.05, max(1e-5, diag * 1e-4))
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=dist)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


# ---------------------------------------------------------------------------
# 临时盖面 —— 破口临时封上,切完原样还给你
# ---------------------------------------------------------------------------


def _find_boundary_loops(bm):
    """找出网格上的边界环(洞 / 裂缝)—— 顺着相邻面的走向走

    返回:顶点**下标**的列表(每个环一串)。

    「顺着相邻面的走向」很重要:环的绕序跟相邻面一致 ⇒ 拿它生成的盖面
    法线朝**实体内部** ⇒ 盖面要反过来才朝外(见 ``_cap_boundary_loops``)。

    ⚠️ **键一律用下标,不能拿 bmesh 元素当字典键** —— bmesh 每次访问
    同一个元素都会给你一个新的 Python 包装对象,拿它当键等于每次都是
    一把新钥匙 ⇒ 查出来永远是空(这个坑踩过一次:环永远找不到)。
    """
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    bm.edges.ensure_lookup_table()
    bm.edges.index_update()

    # 边界边 = 只被一张面用到的边
    boundary = [e for e in bm.edges if len(e.link_faces) == 1]
    if not boundary:
        return []

    # 每条边界边在相邻面里的走向(from → to)
    # 走向 = 顺着**相邻面**的绕序走 ⇒ 盖面要反过来(法线才朝外)
    direction = {}
    for edge in boundary:
        face = edge.link_faces[0]
        for loop in face.loops:
            if loop.edge == edge:
                # BMLoop 没有 other_vert —— 边的另一个端点问 BMEdge 拿
                direction[edge.index] = (
                    loop.vert.index,
                    edge.other_vert(loop.vert).index,
                )
                break

    # 从某个顶点出发能接上哪条边
    #
    # 键是边的**起点**顶点 —— 一条边 a→b 的下一条是「从 b 出发」的那条
    # (按终点查会查回它自己 ⇒ 环永远走不出去)
    next_from = {}
    for edge in boundary:
        pair = direction.get(edge.index)
        if pair is None:
            continue
        next_from.setdefault(pair[0], []).append(edge.index)

    visited = set()
    loops = []
    for edge in boundary:
        if edge.index in visited:
            continue
        start = direction.get(edge.index)
        if start is None:
            continue
        visited.add(edge.index)
        loop_verts = [start[0], start[1]]
        current = start[1]
        guard = len(boundary) + 2
        while guard > 0:
            guard -= 1
            nxt = -1
            for candidate in next_from.get(current) or []:
                if candidate in visited:
                    continue
                nxt = candidate
                break
            if nxt < 0:
                break  # 开口链 —— 到头了
            visited.add(nxt)
            pair = direction.get(nxt)
            if pair is None:
                break
            if pair[1] == loop_verts[0]:
                break  # 环闭合
            loop_verts.append(pair[1])
            current = pair[1]
        if len(loop_verts) >= 3:
            loops.append(loop_verts)
    return loops


def _count_boundary_edges(bm):
    """还剩几条没被两个面共用的边 —— 盖完之后应该归零"""
    return len([e for e in bm.edges if len(e.link_faces) < 2])


def _cap_boundary_loops(obj):
    """给破口**临时**盖上 —— 切完摘掉,用户的模型上不会多出任何面

    盖面用一个**临时材质槽**( ``LID_MATERIAL_NAME`` )标记 ⇒ 布尔之后按
    材质下标就能把它们精确地认出来摘掉(不靠「位置对不对得上」那种猜法
    —— 布尔会把面拆开、挪顶点,位置对不上)。

    返回 dict::

        {"materialIndex": int | None, "cappedLoops": int,
         "lidFaces": int, "closed": bool}
    """
    empty = {
        "materialIndex": None,
        "cappedLoops": 0,
        "lidFaces": 0,
        "closed": True,
    }
    mesh = obj.data

    bm = bmesh.new()
    bm.from_mesh(mesh)
    loops = _find_boundary_loops(bm)
    if not loops:
        # 没找到破口 ⇒ 网格本来就是封闭的 ⇒ 什么都不用加
        bm.free()
        return empty

    # 临时材质槽 —— 加在**最后**,原面的材质下标一个都不动
    #
    # 材质槽住在**网格**上(BMesh 没有 materials 属性)⇒ 加在网格上
    #
    # ⚠️ **没有材质的模型不能直接拿 0 号槽当临时槽** —— 那种模型所有面的
    # 材质下标都是 0,临时槽占了 0 就等于「模型上每张面都是盖面」⇒
    # 切完一摘,整个模型没了(这个坑踩过一次)。所以先垫一个占位槽,
    # 临时槽落在 1 号 —— 占位槽切完连同临时槽一起撤掉。
    placeholder = None
    if len(mesh.materials) == 0:
        placeholder = bpy.data.materials.new(PLACEHOLDER_MATERIAL_NAME)
        mesh.materials.append(placeholder)
    lid_material = bpy.data.materials.new(LID_MATERIAL_NAME)
    mesh.materials.append(lid_material)
    lid_index = len(mesh.materials) - 1

    capped = 0
    for loop_verts in loops:
        try:
            # 盖面要用**反过来**那个环 —— 顺着相邻面走向的环,右手定则算出来
            # 的法线朝着实体**内部**,正着盖会得到一块往里凹的坏件
            # (跟网页端 `magnet-lid.ts` 同一个口径)
            face = bm.faces.new([bm.verts[i] for i in reversed(loop_verts)])
        except ValueError:
            # 环自交 / 顶点重复 —— 这条盖不上,留着让布尔去报错
            continue
        face.material_index = lid_index
        capped += 1

    if capped == 0:
        # 一条都没盖上 ⇒ 网格还是破的(布尔那边会自己想办法)
        closed = _count_boundary_edges(bm) == 0
        bm.free()
        # 临时材质槽用不上 —— 撤掉,别在用户的网格上留垃圾
        _drop_material_slots(mesh, lid_index, placeholder)
        return {
            "materialIndex": None,
            "cappedLoops": 0,
            "lidFaces": 0,
            "closed": closed,
        }

    # 盖完网格就闭合了 ⇒ 让 Blender 重算法线(只改朝向,一个顶点都不动)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    # n-gon 切三角 —— 布尔求解器不吃 n-gon
    ngons = [f for f in bm.faces if len(f.verts) > 3]
    if ngons:
        bmesh.ops.triangulate(bm, faces=ngons)

    lid_faces = len([f for f in bm.faces if f.material_index == lid_index])
    closed = _count_boundary_edges(bm) == 0

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return {
        "materialIndex": lid_index,
        "cappedLoops": capped,
        "lidFaces": lid_faces,
        "closed": closed,
    }


def _drop_material_slots(mesh, lid_index, placeholder=None):
    """把临时材质槽(和占位槽)从网格上撤掉 —— 用户的网格上不留垃圾"""
    for index in sorted(
        [i for i in (lid_index,) if i is not None] + ([] if placeholder is None else [0]),
        reverse=True,
    ):
        try:
            if index < len(mesh.materials):
                mesh.materials.pop(index=index)
        except Exception:
            pass


def _strip_lid_faces(mesh, lid_index):
    """把临时盖面从布尔结果里摘掉 —— 用户的模型上不会多出任何几何

    摘掉之后破口**还在那儿**(开放边又回来了)⇒ 拿到的确实是
    「用户自己的模型 + 一个孔」。
    """
    if lid_index is None:
        return 0
    bm = bmesh.new()
    bm.from_mesh(mesh)
    doomed = [f for f in bm.faces if f.material_index == lid_index]
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(mesh)
        mesh.update()
    bm.free()
    return len(doomed)


def _mesh_volume(target):
    """体积(mm³)—— Blender 单位在这里就是 mm

    ``target`` 可以是对象,也可以是网格(布尔之后的 evaluated 网格)。
    """
    mesh = target.data if hasattr(target, "data") else target
    bm = bmesh.new()
    bm.from_mesh(mesh)
    volume = abs(bm.calc_volume(signed=True))
    bm.free()
    return volume


def _triangle_count(mesh):
    """切完的**三角形**数 —— 跟导出的文件里那张面数对得上

    布尔出来的面里混着 n-gon(带洞的那张底面就是),导出时全三角化了 ⇒
    这里也得数三角,不能数多边形(否则界面上摆的数跟用户看到的文件对不上)。
    """
    try:
        mesh.calc_loop_triangles()
        return len(mesh.loop_triangles)
    except Exception:
        # 兜底 —— n-gon 拆成三角的数量(n − 2)
        return sum(max(0, len(poly.vertices) - 2) for poly in mesh.polygons)


# ---------------------------------------------------------------------------
# 挑面
# ---------------------------------------------------------------------------


def _pick_flat_region(obj):
    """挑**最大的一块平面** —— 跟模型朝向无关

    返回 dict:normal / centroid / area / point / material_index

    ## 为什么要「先分桶、再合并」

    一张张面跟每个簇比是 O(面数 × 簇数) —— 一个二十万面的球能比到
    天荒地老(而这正是这条路的意义:浏览器切不了的往往就是这种大模型)。

    这里分两步:

    1. **按法线量化分桶** —— 一遍扫,O(面数)
    2. **桶之间再合并** —— 桶数比面数少两个数量级,O(桶数²)

    面本身的面积 / 中心 / 法线用 ``foreach_get`` 一次取完(Blender 在 C
    里算好的),不逐面调 ``calc_area()``。
    """
    mesh = obj.data
    count = len(mesh.polygons)
    if count == 0:
        raise BridgeError("模型是空的", "EMPTY_MODEL")

    normals = [0.0] * (count * 3)
    areas = [0.0] * count
    centers = [0.0] * (count * 3)
    material_indices = [0] * count
    mesh.polygons.foreach_get("normal", normals)
    mesh.polygons.foreach_get("area", areas)
    mesh.polygons.foreach_get("center", centers)
    mesh.polygons.foreach_get("material_index", material_indices)

    # 顶点平均 —— 用来判断法线朝内还是朝外
    vertex_count = len(mesh.vertices)
    center = Vector((0.0, 0.0, 0.0))
    if vertex_count:
        coords = [0.0] * (vertex_count * 3)
        mesh.vertices.foreach_get("co", coords)
        center = Vector(
            (
                sum(coords[0::3]) / vertex_count,
                sum(coords[1::3]) / vertex_count,
                sum(coords[2::3]) / vertex_count,
            )
        )

    # ---- 第一步:按法线分桶 ----
    step = math.sin(math.radians(FLAT_CLUSTER_TOLERANCE_DEG)) / 2.0
    if step <= 1e-6:
        step = 1e-3
    buckets = {}
    for index in range(count):
        area = areas[index]
        if area <= 1e-9:
            continue
        nx = normals[index * 3]
        ny = normals[index * 3 + 1]
        nz = normals[index * 3 + 2]
        key = (round(nx / step), round(ny / step), round(nz / step))
        bucket = buckets.get(key)
        if bucket is None:
            buckets[key] = {
                "area": area,
                "normal": Vector((nx * area, ny * area, nz * area)),
                "center": Vector(
                    (
                        centers[index * 3] * area,
                        centers[index * 3 + 1] * area,
                        centers[index * 3 + 2] * area,
                    )
                ),
                "best_area": area,
                "best_index": index,
            }
        else:
            bucket["area"] += area
            bucket["normal"] += Vector((nx * area, ny * area, nz * area))
            bucket["center"] += Vector(
                (
                    centers[index * 3] * area,
                    centers[index * 3 + 1] * area,
                    centers[index * 3 + 2] * area,
                )
            )
            if area > bucket["best_area"]:
                bucket["best_area"] = area
                bucket["best_index"] = index

    if not buckets:
        raise BridgeError("模型没有面", "EMPTY_MODEL")

    # ---- 第二步:桶之间合并(面积大的先占位)----
    cos_tol = math.cos(math.radians(FLAT_CLUSTER_TOLERANCE_DEG))
    clusters = []
    for _key, bucket in sorted(
        buckets.items(), key=lambda item: -item[1]["area"]
    ):
        normal = bucket["normal"].copy()
        if normal.length <= 1e-9:
            continue
        normal.normalize()
        target = None
        for cluster in clusters:
            if cluster["normal"].dot(normal) >= cos_tol:
                target = cluster
                break
        if target is None:
            clusters.append(
                {
                    "normal": normal,
                    "area": bucket["area"],
                    "center": bucket["center"].copy(),
                    "best_area": bucket["best_area"],
                    "best_index": bucket["best_index"],
                }
            )
        else:
            target["normal"] = (
                target["normal"] * target["area"] + bucket["normal"]
            ).normalized()
            target["area"] += bucket["area"]
            target["center"] = target["center"] + bucket["center"]
            if bucket["best_area"] > target["best_area"]:
                target["best_area"] = bucket["best_area"]
                target["best_index"] = bucket["best_index"]

    best = None
    for cluster in clusters:
        cluster["centroid"] = cluster["center"] / cluster["area"]
        # 法线朝外 —— 整体朝内就翻过来
        if cluster["normal"].dot(cluster["centroid"] - center) < 0:
            cluster["normal"] = -cluster["normal"]
        if best is None or cluster["area"] > best["area"]:
            best = cluster

    if best is None:
        raise BridgeError("模型没有面", "EMPTY_MODEL")

    # 质心不一定精确落在面上(浮雕的背面常是一圈边框 + 中间凸起)
    # —— 重新打一条射线落到表面上
    point = _ray_to_surface(obj, best["centroid"], best["normal"])
    material_index = material_indices[best["best_index"]]
    if point is None:
        # 射线没打中(那儿是个坑)—— 退到这块平面里最大的那个面的中心
        index = best["best_index"]
        point = Vector(
            (
                centers[index * 3],
                centers[index * 3 + 1],
                centers[index * 3 + 2],
            )
        )

    return {
        "normal": best["normal"].copy(),
        "centroid": best["centroid"].copy(),
        "area": best["area"],
        "point": point,
        "material_index": material_index,
    }


def _ray_to_surface(obj, point, normal):
    """从 ``point`` 沿着 ``-normal`` 打到表面 —— 打不中返回 None"""
    span = _model_span(obj)
    origin = Vector(point) + normal * (span + 10.0)
    hit, location, _, _ = obj.ray_cast(origin, -normal, distance=span * 3 + 30.0)
    if not hit:
        return None
    return location.copy()


def _local_thickness(obj, point, normal):
    """命中点处的局部厚度(mm)—— 沿朝内方向量到下一个面"""
    span = _model_span(obj)
    origin = Vector(point) - normal * 0.01
    hit, location, _, _ = obj.ray_cast(origin, -normal, distance=span * 4 + 40.0)
    if not hit:
        return None
    return (origin - location).length


def _circle_fits(obj, point, normal, radius):
    """孔圆放不放得下 —— 在切点周围取 8 个点,看是不是都在同一块平面上"""
    span = _model_span(obj)
    tangent = Vector((1.0, 0.0, 0.0))
    if abs(normal.dot(tangent)) > 0.9:
        tangent = Vector((0.0, 1.0, 0.0))
    tangent = (tangent - normal * tangent.dot(normal)).normalized()
    bitangent = normal.cross(tangent).normalized()

    height = 10.0
    for i in range(8):
        angle = 2.0 * math.pi * i / 8.0
        offset = (tangent * math.cos(angle) + bitangent * math.sin(angle)) * radius
        origin = Vector(point) + offset + normal * height
        hit, location, _, _ = obj.ray_cast(origin, -normal, distance=span * 4 + 60.0)
        if not hit:
            return False
        # 命中点应该跟切点在同一个平面上(差一点点是正常的)
        if abs((location - Vector(point)).dot(normal)) > 0.5:
            return False
    return True


# ---------------------------------------------------------------------------
# 切
# ---------------------------------------------------------------------------


def _make_cutter(obj, center, inward, radius, height, material_index):
    """造切刀圆柱(64 段)—— 用 bmesh,不碰 bpy.ops"""
    bm = bmesh.new()
    rotation = (
        Vector((0.0, 0.0, 1.0)).rotation_difference(inward).to_matrix().to_4x4()
    )
    matrix = Matrix.Translation(Vector(center)) @ rotation
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=CUTTER_SEGMENTS,
        radius1=radius,
        radius2=radius,
        depth=height,
        matrix=matrix,
    )
    mesh = bpy.data.meshes.new("MooncodaCutter")
    bm.to_mesh(mesh)
    bm.free()
    # 材质槽跟模型对齐 —— 布尔出来的新面(孔壁)按下标继承被切那个面的材质
    for material in obj.data.materials:
        mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.material_index = material_index
    mesh.update()
    return bpy.data.objects.new("MooncodaCutter", mesh)


def _boolean_cut(obj, cutter, hole_tolerant=True):
    """布尔切孔 —— EXACT 失败退 FAST

    返回 (切完的网格, 用的哪个求解器)。

    **不用 bpy.ops.object.modifier_apply** —— 算子要上下文,timer 里调不稳;
    取 evaluated 网格一样稳。

    ``hole_tolerant`` —— 网格已经封好了就别让求解器「顺手」补洞:
    Blender 的容错模式会把破口**补上**(那就是**改了用户的模型**)。
    只有还有盖不上的破口时才开 —— 那时候宁可让求解器补,也不能切不成。
    """
    obj.modifiers.new("MooncodaPocket", "BOOLEAN")
    modifier = obj.modifiers["MooncodaPocket"]
    modifier.operation = "DIFFERENCE"
    modifier.object = cutter
    try:
        modifier.material_mode = "INDEX"
    except Exception:
        pass
    try:
        modifier.use_hole_tolerant = bool(hole_tolerant)
    except Exception:
        pass

    for solver in ("EXACT", "FAST"):
        try:
            modifier.solver = solver
        except Exception:
            pass
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(
            evaluated, preserve_all_data_layers=True, depsgraph=depsgraph
        )
        if len(mesh.polygons) > 0:
            return mesh, solver
        # 空网格 —— 这个求解器不行,换下一个
        bpy.data.meshes.remove(mesh)
    raise BridgeError("布尔运算失败了(EXACT 和 FAST 都不行)", "BOOLEAN_FAILED")


# ---------------------------------------------------------------------------
# 导出
# ---------------------------------------------------------------------------


def _export_obj(mesh, material_names, out_dir, mtl_name):
    """把网格写成 OBJ(带 UV 和材质分组)"""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.verts.index_update()

    # 三角化交给 Blender 自己
    #
    # ⚠️ **不能用扇形三角化**(从第一个点往后扇)—— 布尔出来的面是「带洞的
    # n-gon」(拆成几块、用桥边连着),扇形三角化会把桥边用成 4 次 ⇒
    # 导出来的模型出现非流形边(工作室拿去切片会报警)。
    # Blender 自己的三角化器知道桥边怎么劈。
    bmesh.ops.triangulate(bm, faces=bm.faces[:])

    uv_layer = bm.loops.layers.uv.active
    uv_index = {}
    uv_list = []

    def uv_id(uv):
        key = (round(float(uv[0]), 6), round(float(uv[1]), 6))
        found = uv_index.get(key)
        if found is None:
            uv_list.append((float(uv[0]), float(uv[1])))
            found = len(uv_list)
            uv_index[key] = found
        return found

    head = ["# Mooncoda magnet pocket (cut by the local Blender bridge)"]
    if mtl_name and material_names:
        head.append("mtllib %s" % mtl_name)
    head.append("")

    vert_lines = []
    for v in bm.verts:
        vert_lines.append("v %.6f %.6f %.6f" % (v.co.x, v.co.y, v.co.z))

    face_lines = []
    faces_by_material = {}
    for face in bm.faces:
        faces_by_material.setdefault(face.material_index, []).append(face)

    for material_index in sorted(faces_by_material.keys()):
        name = None
        if 0 <= material_index < len(material_names):
            name = material_names[material_index]
        if name:
            face_lines.append("usemtl %s" % name)
        for face in faces_by_material[material_index]:
            loop_uvs = []
            for loop in face.loops:
                if uv_layer is not None:
                    loop_uvs.append(uv_id(loop[uv_layer].uv))
                else:
                    loop_uvs.append(None)
            corner = [v.index for v in face.verts]
            # 三角化过了 —— 每张面就是三个点
            tri = corner
            tri_uv = loop_uvs
            if len(tri_uv) == 3 and all(value is not None for value in tri_uv):
                face_lines.append(
                    "f %d/%d %d/%d %d/%d"
                    % (
                        tri[0] + 1,
                        tri_uv[0],
                        tri[1] + 1,
                        tri_uv[1],
                        tri[2] + 1,
                        tri_uv[2],
                    )
                )
            else:
                face_lines.append("f %d %d %d" % (tri[0] + 1, tri[1] + 1, tri[2] + 1))

    vt_lines = ["vt %.6f %.6f" % (u, v) for u, v in uv_list]
    obj_text = "\n".join(head + vert_lines + vt_lines + face_lines) + "\n"

    obj_path = os.path.join(out_dir, EXPORT_OBJ_NAME)
    with open(obj_path, "w", encoding="utf-8") as handle:
        handle.write(obj_text)

    bm.free()
    return obj_path


def _find_mtl(src_dir):
    """找到包里的 MTL 文件 —— 返回 (路径, 文件名)"""
    for name in sorted(os.listdir(src_dir)):
        if name.lower().endswith(".mtl"):
            path = os.path.join(src_dir, name)
            if os.path.isfile(path):
                return path, name
    return None, None


def _pack_result(obj_path, src_dir, out_dir, mtl_name):
    """把切好的 OBJ + 原来的 MTL + 纹理打成一个 zip"""
    zip_path = os.path.join(out_dir, "result.zip")
    mtl_source = None
    if mtl_name:
        candidate = os.path.join(src_dir, mtl_name)
        if os.path.isfile(candidate):
            mtl_source = candidate
    if mtl_source is None:
        mtl_source, _ = _find_mtl(src_dir)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(obj_path, EXPORT_OBJ_NAME)
        if mtl_source is not None:
            archive.write(mtl_source, os.path.basename(mtl_source))
        # 纹理(以及别的附属文件)平铺到根目录
        for name in sorted(os.listdir(src_dir)):
            if name.lower().endswith(".obj") or name.lower().endswith(".mtl"):
                continue
            path = os.path.join(src_dir, name)
            if os.path.isfile(path):
                archive.write(path, name)

    with open(zip_path, "rb") as handle:
        return handle.read()


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def _run_cut(payload):
    """切一刀 —— **跑在 Blender 主线程里**"""
    params = payload.get("params") or {}
    zip_bytes = payload.get("zip") or b""

    dia = _clamp(_to_float(params.get("holeDiaMm"), DEFAULT_HOLE_DIA_MM), 2.0, 60.0)
    depth = _clamp(
        _to_float(params.get("holeDepthMm"), DEFAULT_HOLE_DEPTH_MM), 0.3, 10.0
    )

    workdir = tempfile.mkdtemp(prefix="mooncoda_magnet_")
    src_dir = os.path.join(workdir, "src")
    out_dir = os.path.join(workdir, "out")
    os.makedirs(src_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    collection = None
    obj = None
    cutter = None
    mesh = None
    warnings = []

    try:
        if zip_bytes:
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
                archive.extractall(src_dir)
        obj_path = _find_first(src_dir, ".obj")
        if not obj_path:
            raise BridgeError("包里没有 .obj 文件", "NO_OBJ")

        with open(obj_path, "r", encoding="utf-8", errors="replace") as handle:
            obj_text = handle.read()
        verts, vts, faces, _ = _parse_obj(obj_text)
        if not verts or not faces:
            raise BridgeError("模型是空的", "EMPTY_MODEL")

        _, mtl_name = _find_mtl(src_dir)

        collection = _make_temp_collection()
        obj, slot_names = _build_object(verts, vts, faces, collection)
        _repair_mesh(obj)
        bpy.context.view_layer.update()

        region = _pick_flat_region(obj)
        point = region["point"]
        normal = region["normal"]
        inward = -normal

        thickness = _local_thickness(obj, point, normal)
        if thickness is not None and thickness < depth + MIN_WALL_MM:
            raise BridgeError(
                "这块面太薄(%.2fmm),切 %.2fmm 会捅穿" % (thickness, depth),
                "FACE_NOT_CUTTABLE",
            )

        radius = dia / 2.0
        if not _circle_fits(obj, point, normal, radius):
            raise BridgeError("孔放不进这块面(会切到边上)", "HOLE_SPILLED")

        # 切刀摆放 —— 跟网页端 / 工作室脚本同一套数学
        #   中心 = 面上的点 + 朝内 × (深/2 − 外伸)
        #   高   = 深 + 2 × 外伸(近端在面外 1mm,远端在面内「深」)
        penetration = PENETRATION_MM
        height = depth + 2 * penetration
        center = Vector(point) + inward * (depth / 2.0 - penetration)

        cutter = _make_cutter(
            obj, center, inward, radius, height, region["material_index"]
        )
        collection.objects.link(cutter)

        # ---- 临时盖面:破口封上,切完摘掉 ----
        #
        # 盖面必须在**挑面 / 量厚度 / 试孔之后** —— 盖上的那块也是一块
        # 「平面」,提前盖会让工具把孔切在裂缝上,而不是背面。
        #
        # 盖面只喂给布尔运算 ⇒ 用户的模型上不会多出任何几何(工作室
        # 2026-11-11:「不需要修复用户的模型,只需要完成磁铁孔」)。
        lid = _cap_boundary_loops(obj)
        if lid["cappedLoops"] > 0:
            warnings.append("破口临时封上再切,切完原样还给你")
        if not lid["closed"]:
            warnings.append("有些破口没能封上,那些地方可能被补上")

        # 体积在**盖完之后**量 —— 盖完才是实体,量出来的才是真体积
        before = _mesh_volume(obj)
        if before <= 0 or not lid["closed"]:
            warnings.append("模型不是封闭的,体积算不准")

        mesh, solver = _boolean_cut(obj, cutter, hole_tolerant=not lid["closed"])

        after = _mesh_volume(mesh)
        removed = before - after
        expected = math.pi * radius * radius * depth
        if removed <= 0:
            raise BridgeError("切完体积没变小 —— 没切进去", "NOTHING_CUT")
        if expected > 0 and removed < expected * 0.5:
            warnings.append(
                "去掉量比理论值少(%.1f / %.1f mm³),孔可能切到边上"
                % (removed, expected)
            )

        # 盖面摘掉 —— 破口还在那儿,用户拿到的还是他自己的模型
        stripped = _strip_lid_faces(mesh, lid["materialIndex"])

        exported = _export_obj(mesh, slot_names, out_dir, mtl_name)
        zip_bytes_out = _pack_result(exported, src_dir, out_dir, mtl_name)

        stats = {
            "volumeBeforeMm3": before,
            "volumeAfterMm3": after,
            "removedVolumeMm3": removed,
            "expectedRemovedVolumeMm3": expected,
            # **三角数**,不是多边形数 —— 布尔出来的面里混着 n-gon
            # (带洞的底面就是),导出的文件里全成了三角形 ⇒ 摆多边形数
            # 会跟用户看到的文件对不上
            "triangleCount": _triangle_count(mesh),
            "face": "最大平面 %.1f mm²" % region["area"],
            "solver": solver,
            "warnings": warnings,
            "lidCapped": lid["cappedLoops"],
            "lidFaces": lid["lidFaces"],
            "lidStripped": stripped,
        }
        return zip_bytes_out, stats
    finally:
        # 收干净 —— 别把用户的场景弄脏
        for target in (cutter, obj):
            if target is not None:
                data = target.data
                try:
                    bpy.data.objects.remove(target, do_unlink=True)
                except Exception:
                    pass
                if data is not None:
                    try:
                        bpy.data.meshes.remove(data)
                    except Exception:
                        pass
        if mesh is not None:
            try:
                bpy.data.meshes.remove(mesh)
            except Exception:
                pass
        # 临时盖面 / 占位槽那两个材质 —— 别留在用户的 Blender 里
        # (切一次留一个就成垃圾了)
        for material in list(bpy.data.materials):
            if material.name.startswith(TEMP_MATERIAL_PREFIX) and material.users == 0:
                try:
                    bpy.data.materials.remove(material)
                except Exception:
                    pass
        if collection is not None:
            try:
                bpy.context.scene.collection.children.unlink(collection)
                bpy.data.collections.remove(collection)
            except Exception:
                pass
        shutil.rmtree(workdir, ignore_errors=True)


def _make_temp_collection():
    collection = bpy.data.collections.new("MooncodaTemp")
    bpy.context.scene.collection.children.link(collection)
    return collection


def _find_first(root, suffix):
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in sorted(filenames):
            if name.lower().endswith(suffix):
                return os.path.join(dirpath, name)
    return None


def _to_float(value, fallback):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(result):
        return fallback
    return result


def _clamp(value, low, high):
    return max(low, min(high, value))


# ---------------------------------------------------------------------------
# 界面
# ---------------------------------------------------------------------------


def _prefs(context=None):
    """拿插件偏好 —— 没有就返回 None。

    查的是 ``bpy.context.preferences.addons[<模块名>]`` ——
    只有**装成插件**才在那个表里;直接跑(``--python`` / 粘到 Text Editor)
    时不在 ⇒ 那边端口走默认值。
    """
    try:
        ctx = context or bpy.context
        addon = ctx.preferences.addons.get(ADDON_MODULE)
        if addon is None:
            return None
        return addon.preferences
    except Exception:
        return None


def _bridge_port(prefs=None):
    """当前该用哪个端口 —— 偏好里改了就用偏好里的。"""
    raw = getattr(prefs, "port", None) if prefs is not None else None
    try:
        port = int(raw)
    except (TypeError, ValueError):
        port = DEFAULT_PORT
    if port < 1024 or port > 65535:
        port = DEFAULT_PORT
    return port


class MOONCODA_AddonPreferences(bpy.types.AddonPreferences):
    """插件偏好 —— 端口 + 启用时自动启动。

    Blender 会**自动**把这个类的 ``draw()`` 画在
    Preferences → Add-ons → Mooncoda Magnet Bridge 下面(不用另写面板)。
    """

    # ⚠️ 必须跟模块名一致 —— Blender 靠它把偏好跟插件对上
    bl_idname = ADDON_MODULE

    port: bpy.props.IntProperty(
        name="端口",
        description="桥接在本机开的端口 —— 网页端那边填一样的数(改完要重启桥接)",
        default=DEFAULT_PORT,
        min=1024,
        max=65535,
    )
    auto_start: bpy.props.BoolProperty(
        name="启用时自动启动桥接",
        description="一打开 Blender 就把桥接起上(不用每次手动点)",
        default=True,
    )

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "port")
        layout.prop(self, "auto_start")
        layout.separator()
        if _server is not None:
            layout.label(text="桥接运行中:%d" % _server_port, icon="CHECKMARK")
        else:
            layout.label(text="桥接没起", icon="INFO")
        layout.operator("mooncoda.start_bridge", icon="PLAY")
        layout.operator("mooncoda.stop_bridge", icon="PAUSE")


class MOONCODA_PT_bridge(bpy.types.Panel):
    bl_label = "Mooncoda 磁吸孔桥接"
    bl_idname = "MOONCODA_PT_bridge"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Mooncoda"

    def draw(self, context):
        layout = self.layout
        if _server is not None:
            layout.label(text="桥接运行中:%d" % _server_port, icon="CHECKMARK")
            layout.label(text="网页端选「本地 Blender」就能用了")
        else:
            layout.label(text="桥接没起", icon="INFO")

        prefs = _prefs(context)
        row = layout.row()
        if prefs is not None:
            row.prop(prefs, "port")
        else:
            row.label(text="端口 %d" % DEFAULT_PORT)
        row.operator("mooncoda.start_bridge", icon="PLAY")
        layout.operator("mooncoda.stop_bridge", icon="PAUSE")
        layout.separator()
        layout.operator("mooncoda.open_web", icon="URL")


class MOONCODA_OT_start_bridge(bpy.types.Operator):
    bl_idname = "mooncoda.start_bridge"
    bl_label = "启动桥接"
    bl_description = (
        "在本机起一个 127.0.0.1 的小服务,让网页版的磁吸孔工具调用本机 Blender"
    )

    def execute(self, context):
        prefs = _prefs(context)
        port = _bridge_port(prefs)
        if _server is not None:
            if _server_port == port:
                self.report({"INFO"}, "桥接已经在跑了:127.0.0.1:%d" % _server_port)
                return {"FINISHED"}
            # 端口改过了 —— 重起,不然还挂在旧端口上
            stop_bridge()
        started = start_bridge(port)
        if started is None:
            self.report({"ERROR"}, "端口 %d 起不来(可能已被占用)" % DEFAULT_PORT)
        else:
            self.report({"INFO"}, "桥接已启动:127.0.0.1:%d" % port)
        return {"FINISHED"}


class MOONCODA_OT_stop_bridge(bpy.types.Operator):
    bl_idname = "mooncoda.stop_bridge"
    bl_label = "停止桥接"

    def execute(self, context):
        stop_bridge()
        self.report({"INFO"}, "桥接已停止")
        return {"FINISHED"}


class MOONCODA_OT_open_web(bpy.types.Operator):
    bl_idname = "mooncoda.open_web"
    bl_label = "打开磁吸孔页面"
    bl_description = "在浏览器里打开网页版的磁吸孔切割工具"

    def execute(self, context):
        try:
            bpy.ops.wm.url_open(url=MAGNET_PAGE_URL)
        except Exception:
            self.report({"ERROR"}, "打不开页面,手动访问 %s" % MAGNET_PAGE_URL)
        return {"FINISHED"}


_CLASSES = (
    MOONCODA_AddonPreferences,
    MOONCODA_PT_bridge,
    MOONCODA_OT_start_bridge,
    MOONCODA_OT_stop_bridge,
    MOONCODA_OT_open_web,
)


def register():
    for cls in _CLASSES:
        # 插件偏好只在**装成插件**时才有意义 —— 直接跑的时候 Blender 的
        # 插件表里没有这一条,注册了也取不到(老版本 Blender 还会直接报错)
        if cls is MOONCODA_AddonPreferences and ADDON_MODULE == "__main__":
            continue
        bpy.utils.register_class(cls)
    # 装成插件之后,**一打开 Blender 就把桥接起上** —— 装一次就行,
    # 不用每次都去面板里点一下「启动桥接」。
    # 偏好拿不到(直接跑 / --factory-startup)就按默认来。
    #
    # ⚠️ **后台模式不自动起** —— `--background` 下没有事件循环,起来了
    # 也没人跑活(作业会堆在队列里等到超时),而且 `register()` 里不能阻塞
    # (会把整个 Blender 卡住)。后台模式由 `__main__` 那条路显式起 +
    # `_pump_forever()` 自己泵。
    prefs = _prefs()
    auto = True if prefs is None else bool(getattr(prefs, "auto_start", True))
    if auto and not bpy.app.background:
        start_bridge(_bridge_port(prefs))


def unregister():
    stop_bridge()
    for cls in reversed(_CLASSES):
        try:
            bpy.utils.unregister_class(cls)
        except Exception:
            pass


# 直接跑(粘到 Scripting 里 Run Script / 或者 `blender --background --python
# 本文件`)→ 立刻起桥接
if __name__ == "__main__":
    # 输出别被缓冲 —— 命令执行(重定向到文件 / 管道)时 Python 默认是块缓冲,
    # 「桥接已启动」那行要等很久才出来,用户会以为没起来
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass
    register()
    _port = start_bridge(DEFAULT_PORT)
    if _port is None:
        raise SystemExit(1)
    if bpy.app.background:
        # 后台模式:**脚本不能返回**(返回了 Blender 就退出了)
        _pump_forever()
    else:
        print("[Mooncoda] 图形界面模式:关掉这个窗口就停桥接")
