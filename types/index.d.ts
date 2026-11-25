/** 主对话最近一次碰到缓存的请求：发送时刻（毫秒）与缓存时长。 */
export type CacheMark = { at: number; ttl: '5m' | '1h' }

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': { last: Shaped<CacheMark | null> }
  }
}
