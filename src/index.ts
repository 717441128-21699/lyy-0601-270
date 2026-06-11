import express from 'express';
import cors from 'cors';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { deduplicateMiddleware } from './middleware/deduplicate';
import { successResponse } from './utils';

import tournamentsRouter from './routes/tournaments';
import playersRouter from './routes/players';
import roomsRouter from './routes/rooms';
import groupsRouter from './routes/groups';
import roundsRouter from './routes/rounds';
import matchesRouter from './routes/matches';
import refereesRouter from './routes/referees';
import standingsRouter from './routes/standings';
import notificationsRouter from './routes/notifications';
import substitutionsRouter from './routes/substitutions';
import seatAssignmentsRouter from './routes/seatAssignments';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(deduplicateMiddleware);

app.get('/api/health', (req, res) => {
  res.json(successResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  }, '服务运行中'));
});

app.use('/api/tournaments', tournamentsRouter);
app.use('/api/players', playersRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/rounds', roundsRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/referees', refereesRouter);
app.use('/api/standings', standingsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/substitutions', substitutionsRouter);
app.use('/api/seat-assignments', seatAssignmentsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 桌游赛事计分服务已启动`);
  console.log(`📍 服务地址: http://localhost:${PORT}`);
  console.log(`📡 API 健康检查: http://localhost:${PORT}/api/health`);
  console.log(`\n📚 API 模块列表:`);
  console.log(`   - 赛事管理: /api/tournaments`);
  console.log(`   - 选手管理: /api/players`);
  console.log(`   - 房间管理: /api/rooms`);
  console.log(`   - 分组管理: /api/groups`);
  console.log(`   - 轮次管理: /api/rounds`);
  console.log(`   - 对局管理: /api/matches`);
  console.log(`   - 裁判管理: /api/referees`);
  console.log(`   - 计分榜单: /api/standings`);
  console.log(`   - 通知中心: /api/notifications`);
  console.log(`   - 退赛替补: /api/substitutions`);
  console.log(`   - 座位分配: /api/seat-assignments`);
});

export default app;
