# 风页共享书架服务

一个零依赖 Node 服务，用来把书从发送端 App 推送到指定的接收手机。

## 本地运行

```bash
cd server
LIBRARY_CODE="FENGYE-123456" ADMIN_CODE="admin-please-change" node server.js
```

打开 `http://localhost:8787/api/health` 能看到 `ok: true`。

## 部署到 Render

1. 把整个 `server/` 目录放到一个 GitHub 仓库。
2. Render → New → Blueprint，选择这个仓库；或 New Web Service，Root Directory 填 `server`。
3. Build Command：`npm install`；Start Command：`npm start`。
4. 在 Environment 里设置：
   - `LIBRARY_CODE`：朋友加入用的共享码，例如 `FENGYE-7K2M9Q`
   - `ADMIN_CODE`：发送端推送用的管理码，长一点
   - `DATA_DIR`：`/data`（如果挂了持久磁盘）
5. 部署完成后得到 `https://xxxx.onrender.com`，填进 App 的「共享书架」。

> Render 免费实例的磁盘是临时的，重启/重新部署后书会丢。长期使用请挂持久磁盘（Disk），把 `DATA_DIR` 指向磁盘挂载目录；或者部署到 Railway/VPS。
>
> 免费实例闲置会休眠，App 打开轮询时会把它唤醒，第一次可能要等几十秒。

## 部署到 Railway

1. New Project → Deploy from GitHub，选择 `server/`。
2. Railway 会识别 `Dockerfile`。
3. 设置 `LIBRARY_CODE`、`ADMIN_CODE`、`DATA_DIR=/data`，并给服务挂一个 Volume 到 `/data`。
4. 生成公网域名。

## 部署到自己的 VPS

```bash
cd server
LIBRARY_CODE="..." ADMIN_CODE="..." DATA_DIR=/var/lib/fengye-share node server.js
```

前面套 Nginx/Caddy 提供 HTTPS。App 里必须填 `https://` 地址。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/join` | `{code,name}` 配对，返回设备 token |
| GET | `/api/poll?since=N` | 设备轮询新书，需要 `Authorization: Bearer token` |
| GET | `/api/books/:id` | 下载书 JSON，需要设备 token |
| GET | `/api/devices` | 设备列表，需要 `X-Admin-Code` |
| POST | `/api/push` | 推书，需要 `X-Admin-Code` |
| DELETE | `/api/books/:id` | 删除书，需要 `X-Admin-Code` |

推送体：

```json
{
  "meta": { "title": "书名", "author": "作者", "format": "TXT" },
  "chapters": [{ "title": "第一章", "blocks": [{ "t": "p", "x": "正文" }] }],
  "targets": ["dev_xxx"],
  "sender": "我的手机"
}
```

## 安全说明

- 共享码只用于加入；管理码只用于查看设备/推送，不要发给接收方。
- 接收方必须自己安装 App、输入共享码并连接，不存在静默控制。
- 公网必须用 HTTPS；不要把管理码写进公开网页。
- 书籍内容存在服务器 `DATA_DIR/books/`，请自行备份。
