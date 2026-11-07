# dsh-workspace

这个仓库由 DSH agent 通过本机 Git + GitHub REST API 自动创建并推送，用来验证「本机 → GitHub」的完整链路。

## 连接方式

- 认证：fine-grained Personal Access Token（存于本机工作区的 `.env`，不进版本库）
- 传输：HTTPS + git 自带的 OpenSSL TLS 后端（本机系统 schannel 不可用）
- 能力：clone / commit / push / 开 PR / 读写 issue

## 约定

- 分支：`main` 为默认分支
- 提交：由 agent 生成，作者身份为仓库所有者
- 敏感信息一律走 `.env`，不写入仓库

## 当前状态

首次推送完成，链路可用。
