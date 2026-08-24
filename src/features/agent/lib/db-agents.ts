/**
 * 代理商数据库访问层
 *
 * 业务模型见 src/db/schema.ts 的 `agent` 表注释。
 * 列表 / 创建 / 更新 / 启停 全部走这里，UI 与 server actions 都共享同一份映射。
 */

import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { type Agent, agent, type NewAgent, promptOrder } from "@/db/schema";
// NewAgent 仅在 insertAgentToDb 签名里用到

/**
 * 代理商 + 订单数（管理后台列表展示用）。
 * 与 Agent 不同之处：多了 orderCount: number（按 agentId group by 统计）。
 */
export type AgentWithCount = Agent & { orderCount: number };

/**
 * 获取所有代理商 + 各自的订单数（按创建时间升序，列表页用）
 *
 * 不走 LEFT JOIN 的关系查询 —— Drizzle 关系查询会触发 N+1；
 * 改用一次 groupBy 聚合 + 内存里 map 合并，2 条 SQL 完成。
 */
export async function listAgentsFromDb(): Promise<AgentWithCount[]> {
  const [rows, counts] = await Promise.all([
    db.query.agent.findMany({
      orderBy: [asc(agent.createdAt)],
    }),
    db
      .select({
        agentId: promptOrder.agentId,
        n: sql<number>`count(*)::int`,
      })
      .from(promptOrder)
      .groupBy(promptOrder.agentId),
  ]);

  const countMap = new Map(
    counts
      .filter((c): c is { agentId: string; n: number } => c.agentId !== null)
      .map((c) => [c.agentId, c.n])
  );

  return rows.map((a) => ({
    ...a,
    orderCount: countMap.get(a.id) ?? 0,
  }));
}

/**
 * 获取启用的代理商（订单创建表单下拉用；停用的过滤掉）
 *
 * 仅返回 id / name / contact 三个字段，避免把 email/phone/remark 等内部信息
 * 暴露给订单创建上下文（订单创建走的是 protectedAction，不止 admin）。
 */
export async function listActiveAgentsFromDb(): Promise<
  Pick<Agent, "id" | "name" | "contact">[]
> {
  return db.query.agent.findMany({
    where: eq(agent.isActive, true),
    orderBy: [asc(agent.name)],
    columns: { id: true, name: true, contact: true },
  });
}

/**
 * 单条查询（编辑/删除前预校验、关联订单展示等场景）
 */
export async function getAgentFromDb(id: string): Promise<Agent | null> {
  const row = await db.query.agent.findFirst({
    where: eq(agent.id, id),
  });
  return row ?? null;
}

/**
 * 新建代理商
 *
 * ID 由调用方生成（actions 层用 nanoid 12 位），便于跨表引用稳定。
 */
export async function insertAgentToDb(input: NewAgent): Promise<Agent> {
  const [row] = await db.insert(agent).values(input).returning();
  if (!row) {
    throw new Error("新建代理商失败");
  }
  return row;
}

/**
 * 更新代理商基础字段（不含 isActive，走 setAgentActive）
 *
 * Patch 类型与 actions 层对齐：nullable 列允许 `string | null`
 * （明确清空）或 `undefined`（不更新该列）。
 *
 * 更新时不改 updatedAt 让 Drizzle 不动也行，但 schema 已 notNull().defaultNow()，
 * 让数据库自己维护时间戳更稳。
 */
type AgentPatch = {
  name?: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  remark?: string | null;
  isActive?: boolean;
};

export async function updateAgentInDb(
  id: string,
  patch: AgentPatch
): Promise<Agent | null> {
  const [row] = await db
    .update(agent)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(agent.id, id))
    .returning();
  return row ?? null;
}

/**
 * 启停代理商（不停用 = 软删除，订单 FK 已设 set null，历史订单不丢）
 */
export async function setAgentActiveInDb(
  id: string,
  isActive: boolean
): Promise<Agent | null> {
  const [row] = await db
    .update(agent)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(agent.id, id))
    .returning();
  return row ?? null;
}

/**
 * 硬删除（备用：当前 UI 不暴露，仅供数据迁移 / 误建清理使用）
 */
export async function deleteAgentFromDb(id: string): Promise<boolean> {
  const rows = await db.delete(agent).where(eq(agent.id, id)).returning();
  return rows.length > 0;
}
