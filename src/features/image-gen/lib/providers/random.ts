// 共享的确定性伪随机生成器
// 用于避免 SSR/CSR Hydration 不一致

export function createSeededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

// 共享实例
export const seededRandom = createSeededRandom(42);
