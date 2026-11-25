# cache-timer

A Claude Code mod that shows how long the main conversation's **prompt cache** stays warm, right next to the model and permission labels under the prompt box.

```
━━━━━ 52:13   Opus 5.5  High   Bypass permissions
```

- **Countdown**: time left before the cached conversation expires. Each request to the model restarts it.
- **TTL auto-detected**: 1 hour normally; when usage goes into overage the cache drops to 5 minutes and the timer shows `5m` after the time.
- **Colors**: green while warm, yellow near expiry (5 min left on a 1 h cache, 1 min on a 5 m cache), red `COLD` once expired. `HOT` (full bar) while a request is in flight.
- **Reminders**: a toast near expiry and one when the cache goes cold.
- **Optional progress bar**: 5 segments before the time; turn it off to show the time alone.
- **中文 / English** reminders.

The cache only affects speed and quota: after it expires nothing in the conversation is lost, but the next message re-processes the whole conversation.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install cache-timer --marketplace zhangyizhen123/claude-cache-timer
```

Answer `y` to add the marketplace, then pick a scope (user scope is first).

From a shell:

```
claude plugin install cache-timer --marketplace zhangyizhen123/claude-cache-timer
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `zhangyizhen123/claude-cache-timer`, then **Add plugin**.

## Options

| Option | Values | Default | What it does |
|---|---|---|---|
| `language` | `auto`, `zh`, `en` | `auto` | Language of the reminders. `auto` follows Claude Code's `language` setting, English if unset. |
| `showBar` | `true`, `false` | `true` | Show the progress bar before the countdown. |

## How it works

On every main-conversation request the mod records when it was sent and, from the response's usage, whether the cache was written for 1 hour or 5 minutes. The countdown is that send time plus the TTL, so it can differ from the server's exact expiry by a few seconds. Subagent requests are ignored: they keep caches of their own.

## 中文说明

在输入框下方、模型和权限旁边，显示主对话 prompt cache（提示缓存）还剩多久过期。

- 平时缓存保留 1 小时；进入超额用量（overage）后降为 5 分钟，时间后面会显示 `5m`。
- 绿色表示缓存还在；快过期时变黄，这时发一条消息就能续上；过期后显示红色 `COLD`，下一条消息会慢一点、多耗些额度，但对话内容不会丢。
- 选项 `showBar` 控制是否显示进度条；`language` 选 `zh` 时提醒用中文。

## License

MIT
