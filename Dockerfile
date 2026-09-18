FROM node:20-alpine

WORKDIR /app

# 仅先拷贝依赖清单，利用构建缓存
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 拷贝应用代码与随容器分发的示例数据
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY data ./data

# 运行时数据（state.json）写入该目录，compose 中挂载为命名卷
RUN mkdir -p /app/data
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

# 简易健康检查：Node 20 自带 fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
