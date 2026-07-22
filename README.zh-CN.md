<div align="center">

# 🛰️ Beacon

### 面向并行 AI 编码 agent 的实时在场感知与碰撞规避

在同一个仓库里同时跑 2 个、5 个、10 个 Claude Code 会话 —— 从此**不再让它们互相覆盖对方的改动**。

<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

[![License: MIT](https://img.shields.io/badge/License-MIT-4c9aff.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-3fb950.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-3fb950.svg)](package.json)
[![Works with Claude Code](https://img.shields.io/badge/works%20with-Claude%20Code-8b5cf6.svg)](https://docs.claude.com/en/docs/claude-code)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-ffb547.svg)](CONTRIBUTING.md)

<img src="docs/hero.svg" alt="Beacon 实时面板:两个 agent 正在改同一个文件并触发 overlap 警告" width="720" />

</div>

---

## 痛点

并行跑多个 AI 编码 agent 已经是常态 —— 一个会话重构 API,另一个写测试,第三个改配置。速度确实翻倍,直到其中两个改到了同一个文件,或者某个会话跑了 `git checkout` / `git stash`,悄无声息地把别人正在改的文件从脚下抽走。而你往往是在**改动已经丢了之后**才发现碰撞。

Agent 们在盲飞。**它们看不见彼此。**

## Beacon 做什么

Beacon 是一个极小的本地服务,给每个 agent 一张共享的、实时的"谁在动什么"的画面 —— 并在两者刚一重叠的瞬间就发出提醒。

- 👀 **互相感知** —— 每个会话上报自己在改什么,其他人实时可见。
- ⚡ **上下文内的碰撞警告** —— 当一个 agent 即将编辑另一个 agent 已经在改的文件时,Beacon 会在编辑发生**之前**,把一行提醒**注入到该 agent 自己的上下文里**。
- 🔪 **守卫破坏性 git 操作** —— 当别的会话在同一工作树里有未保存改动时,`checkout` / `reset --hard` / `stash` / `rebase` / `clean` 会让 agent 收到警告(或被要求确认)。
- 📊 **实时面板** —— 一个本地网页,实时展示每一个活跃的 agent。
- 🪶 **轻若无物、无感知** —— 零依赖、100% 本地,而且**永不阻塞你的工作**。没有冲突时,你根本察觉不到它在运行。

> **设计上就安全:** Beacon 是 advisory(建议式)的。它*失败即放行(fail open)* —— 一旦守护进程没起或任何环节出错,你的会话行为跟没装 Beacon 时**完全一样**。默认永不拒绝任何编辑;在常见的(无重叠)情况下,它给 agent 上下文增加的 token 是**零**。

---

## 快速开始

```bash
# 1. 获取(需要 Node ≥ 18)
git clone https://github.com/a1473838623/agent-beacon.git && cd agent-beacon
npm link            # 把 `beacon` 命令装到 PATH 上(或:npm i -g agent-beacon)

# 2. 在你的项目里,接好 Claude Code + 启动守护进程
cd /path/to/your/project
beacon init         # 往 .claude/settings.json 装一个 PreToolUse hook
beacon start -d     # 后台启动本地守护进程

# 3. 实时查看
open http://127.0.0.1:4517
```

配置到此为止。**该项目里新开的 Claude Code 会话现在会自动上报活动** —— 无需每个会话手动操作,也没有需要记住的提示词。

再开一个会话,让两个会话都去改同一个文件,你会看到面板上 overlap 亮起,同时第二个 agent 在它的上下文里收到警告。

---

## 工作原理

```
   Claude Code 会话  ──PreToolUse hook──┐
   Cursor / MCP agent ──MCP 工具*───────┤
   git / docker / CI  ──with_report─────┼──▶  beacon 守护进程  ──▶  实时面板
   任意编辑器 / 人     ──文件监听────────┘      (本地 HTTP, JSONL)     + 上下文内警告
```

一个理念贯穿到底:**一条活动就是 `{ actor, action, target }`** —— "会话 A 正在*编辑* `orders.ts`"。一切都是向总线上报活动的客户端;守护进程负责检测重叠,并回答*"还有别人在动这个吗?"*。就这么简单。

- **上报(report)** 和 **查询(query)** 是仅有的两个操作。`report` 的响应里甚至直接带回冲突,所以一个 agent 在"宣告自己在做什么"的同一次调用里,就得知了重叠。
- **上报是带外的**(在 hook / shell 包裹里完成),所以你的 agent 为"宣告自己"花费的 token 是零。
- **只有真正发生冲突时才浮现感知** —— 一行简短、切题的提示,恰好在需要的时候出现。

---

## 集成

Beacon **并不锁定在 Claude Code 上**。内核是一条语言无关的本地 HTTP 总线;每种集成只是把活动喂给它的一种方式。

| 参与方 | 如何上报 | 能收到上下文内警告吗? |
|---|---|---|
| **Claude Code** | `beacon init`(PreToolUse hook)—— 自动、零配置 | ✅ 能,在编辑前注入 |
| **任意 MCP agent** *(Cursor、Cline、Windsurf、Zed…)* | MCP `report` / `query` 工具 *(规划中)* | ➖ 能查询;是否警告取决于该客户端 |
| **git / docker / CI 脚本** | `with_report <action> <target> -- <cmd>` | — |
| **任意编辑器或人** | `beacon watch <dir>`(文件系统监听) | — |
| **任何会说 HTTP 的东西** | `POST /report` | — |

Claude Code 体验最好,因为它的 hook 让 Beacon 既能自动上报,又能把警告在任务进行中注入回 agent。其他工具依然会出现在面板上,以及别人的警告里。

---

## 配置

全部可选 —— 开箱即用的默认值都很合理。以环境变量设置。

| 变量 | 默认值 | 含义 |
|---|---|---|
| `BEACON_PORT` | `4517` | 守护进程端口(仅本机) |
| `BEACON_GUARD` | `warn` | `warn` = 建议式上下文 · `ask` = 破坏性 git 操作需确认 · `off` = 只上报、从不警告 |
| `BEACON_TTL_MS` | `900000` | 一条活动无心跳能存活多久(15 分钟)—— 崩溃的会话会自动清除 |
| `BEACON_HOME` | `~/.beacon` | 守护进程存放 pidfile 和活动日志的位置 |

---

## 常见问题

**会拖慢我的 agent、或让 token 用量暴涨吗?**
不会。上报是带外完成的(在 hook 里,不在模型里),所以不花模型 token。唯一会加进 agent 上下文的,是一行警告,而且仅在真有重叠时才出现。没有冲突 → 什么都不加。

**会打断我的工作流 / 阻止某次编辑吗?**
默认不会。它是建议式的、失败即放行 —— 守护进程没起、超时、输入异常,一律"什么都不做、放行"。只有当你*希望*破坏性 git 操作在真冲突时暂停确认,才设 `BEACON_GUARD=ask`。

**会把我的代码传到别处吗?**
不会。一切都在本地 —— 一个跑在 `127.0.0.1` 的守护进程,一份 `~/.beacon` 下的追加式日志。无网络、无遥测、无账号。

**它会取代 git / 锁 / worktree 吗?**
不会 —— 它是它们*下面*的感知层。它不加锁、不移动文件;它让 agent 们*看见*彼此,好让它们(或你)去协调。如果你用 git worktree,两者完美搭配。

---

## 路线图

- [ ] 原生 **MCP 服务器**(`report` / `query` 作为工具),支持 Cursor、Cline、Windsurf、Zed 和 Claude Agent SDK
- [ ] `SessionStart` hook:每个新会话启动时,先打个招呼、汇总同伴们正在做什么
- [ ] 对真正需要串行的资源提供可选的硬**租约**(比如一次只允许一个构建)
- [ ] 重叠时的 Slack / 桌面通知
- [ ] `npx agent-beacon` 免安装运行

欢迎提想法和 PR —— 见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 参与贡献

Beacon 刻意做得很小(几百行,零依赖)。这让它易读、易改、也易于信任。用 `npm test` 跑测试。非常欢迎 issue 和 pull request。

## 许可证

[MIT](LICENSE) © Beacon contributors
