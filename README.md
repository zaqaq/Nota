# Nota

服务端在 `server/`，移动端在 `mobile/`。Agent、额度和历史检索只在服务端。

## 服务端

需要 Node.js 20 或以上。

```bash
cd server
npm install
npm start
```

`.env` 已可沿用。网页打开 http://127.0.0.1:3000 。手机和电脑要在同一 Wi-Fi，App 访问电脑的局域网 IP，端口 3000。

额度测试：

```bash
cd server
npm test
```

## 移动端

```bash
cd mobile
pnpm install
npx expo start
```

模拟器默认请求 `http://127.0.0.1:3000`。真机请设置 `EXPO_PUBLIC_API_URL=http://电脑局域网IP:3000`。

## 架构与取舍

网页和 App 把文字和一个单号交给同一个 Node 服务。SQLite 先用事务占住当天额度，占到以后才进入手写的 Agent 循环。Agent 自己决定调用创建待办、设置提醒和查询历史。提醒记在这条记录上。历史按关键词匹配。日期用上海时区，由服务端计算。同一个单号再提交不会多扣。额度用并发请求证明：15 个同时发出的请求只有 10 个成功。
