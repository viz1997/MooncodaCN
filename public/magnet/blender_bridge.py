# -*- coding: utf-8 -*-
"""Mooncoda 磁吸孔桥接插件(Mooncoda Magnet Bridge)

网页版(/tools/magnet)的「本地 Blender」那条路靠它。

用法(两种都行):

  A. **直接跑**(最省事)
     Blender → Scripting → 新建文本 → 把本文件整个粘进去 → Run Script
     跑完桥接就起了,控制台会打印端口(默认 8765)。

  B. **装成插件**
     把本文件压成 ``blender_bridge.zip``(压缩包里就这一个文件),
     Blender → Edit → Preferences → Add-ons → Install… → 选那个 zip,
     然后在 3D 视图右侧(N 面板)→ Mooncoda 里点「启动桥接」。

它做什么:

  1. 网页版把模型**送到本机**的 ``127.0.0.1:<端口>``(zip:OBJ + MTL + 纹理)
  2. 插件导入 → 修网格(合并重复顶点 / 重算法线)→ 挑**最大的一块平面**
  3. 在那块平面上挖一个圆柱沉孔(EXACT 求解器,失败退 FAST)
  4. 导回 zip(OBJ + MTL + 纹理)给网页版

模型**不出这台电脑** —— 全程只跟 127.0.0.1 说话,没有上传、没有账号。

## 为什么挑「最大的一块平面」而不是「六个轴向」

工作室原来那段脚本只在六个轴向里找背面 —— 那个模型在 Blender 里是轴对齐的,
所以背面正好平行于某个轴,看起来像「智能」。模型一歪,六面里就没有背面了。
这里按**面积**找最大的平面区域,跟模型朝向无关。
"""

bl_info = {
    "name": "Mooncoda Magnet Bridge",
    "author": "Mooncoda",
    "version": (1, 0, 0),
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
import tempfile
import threading
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
    try:
        bpy.app.timers.register(_drain_jobs, persistent=True)
        _timer_registered = True
    except Exception:
        print("[Mooncoda] 定时器注册失败:", traceback.format_exc())


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


def _boolean_cut(obj, cutter):
    """布尔切孔 —— EXACT 失败退 FAST

    返回 (切完的网格, 用的哪个求解器)。

    **不用 bpy.ops.object.modifier_apply** —— 算子要上下文,timer 里调不稳;
    取 evaluated 网格一样稳。
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
        modifier.use_hole_tolerant = True
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
            # 扇形三角化 —— OBJ 的 n-gon 不保险
            for i in range(1, len(corner) - 1):
                tri = [corner[0], corner[i], corner[i + 1]]
                tri_uv = [loop_uvs[0], loop_uvs[i], loop_uvs[i + 1]]
                if all(value is not None for value in tri_uv):
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
                    face_lines.append(
                        "f %d %d %d" % (tri[0] + 1, tri[1] + 1, tri[2] + 1)
                    )

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

        before = _mesh_volume(obj)
        if before <= 0:
            warnings.append("模型不是封闭的,体积算不准")

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

        mesh, solver = _boolean_cut(obj, cutter)

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

        exported = _export_obj(mesh, slot_names, out_dir, mtl_name)
        zip_bytes_out = _pack_result(exported, src_dir, out_dir, mtl_name)

        stats = {
            "volumeBeforeMm3": before,
            "volumeAfterMm3": after,
            "removedVolumeMm3": removed,
            "expectedRemovedVolumeMm3": expected,
            "triangleCount": len(mesh.polygons),
            "face": "最大平面 %.1f mm²" % region["area"],
            "solver": solver,
            "warnings": warnings,
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
            layout.operator("mooncoda.start_bridge", icon="PLAY")


class MOONCODA_OT_start_bridge(bpy.types.Operator):
    bl_idname = "mooncoda.start_bridge"
    bl_label = "启动桥接"
    bl_description = (
        "在本机起一个 127.0.0.1 的小服务,让网页版的磁吸孔工具调用本机 Blender"
    )

    def execute(self, context):
        port = start_bridge(DEFAULT_PORT)
        if port is None:
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


_CLASSES = (
    MOONCODA_PT_bridge,
    MOONCODA_OT_start_bridge,
    MOONCODA_OT_stop_bridge,
)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    stop_bridge()
    for cls in reversed(_CLASSES):
        try:
            bpy.utils.unregister_class(cls)
        except Exception:
            pass


# 直接跑(粘到 Scripting 里 Run Script)→ 立刻起桥接
if __name__ == "__main__":
    register()
    start_bridge(DEFAULT_PORT)
