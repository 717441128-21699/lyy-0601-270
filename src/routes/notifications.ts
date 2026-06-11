import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { generateId, now, successResponse, errorResponse, paginate } from '../utils';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { tournament_id, round_id, type, title, content, target_type = 'all', target_id } = req.body;

  if (!tournament_id || !type || !title) {
    return res.status(400).json(errorResponse('缺少必要参数: tournament_id, type, title', 400));
  }

  const validTargetTypes = ['all', 'player', 'group'];
  if (!validTargetTypes.includes(target_type)) {
    return res.status(400).json(errorResponse('无效的 target_type，可选值: all, player, group', 400));
  }

  if ((target_type === 'player' || target_type === 'group') && !target_id) {
    return res.status(400).json(errorResponse(`当 target_type 为 ${target_type} 时，必须提供 target_id`, 400));
  }

  const db = getDb();

  const tournament = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournament_id);
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  if (round_id) {
    const round = db.prepare('SELECT id FROM rounds WHERE id = ? AND tournament_id = ?').get(round_id, tournament_id);
    if (!round) {
      return res.status(404).json(errorResponse('轮次不存在', 404));
    }
  }

  const id = generateId();
  db.prepare(`
    INSERT INTO notifications (
      id, tournament_id, round_id, type, title, content,
      target_type, target_id, is_read, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    tournament_id,
    round_id || null,
    type,
    title,
    content || null,
    target_type,
    target_id || null,
    now()
  );

  res.status(201).json(successResponse({
    id,
    target_type,
    target_id: target_id || null,
  }, '通知发送成功'));
});

router.get('/', (req: Request, res: Response) => {
  const { tournament_id, target_type, target_id, is_read, page = 1, pageSize = 20 } = req.query;

  if (!tournament_id) {
    return res.status(400).json(errorResponse('缺少 tournament_id 参数', 400));
  }

  const db = getDb();
  const { limit, offset } = paginate(Number(page), Number(pageSize));

  const whereConditions = ['tournament_id = ?'];
  const params: any[] = [tournament_id];

  if (target_type) {
    whereConditions.push('target_type = ?');
    params.push(target_type);
  }

  if (target_id) {
    whereConditions.push('target_id = ?');
    params.push(target_id);
  }

  if (is_read !== undefined) {
    whereConditions.push('is_read = ?');
    params.push(is_read === 'true' || is_read === '1' ? 1 : 0);
  }

  const whereClause = whereConditions.join(' AND ');

  const countResult = db.prepare(`
    SELECT COUNT(*) as total
    FROM notifications
    WHERE ${whereClause}
  `).get(...params) as { total: number };

  const notifications = db.prepare(`
    SELECT 
      id, tournament_id, round_id, type, title, content,
      target_type, target_id, is_read, created_at
    FROM notifications
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json(successResponse({
    list: notifications,
    total: countResult.total,
    page: Number(page),
    pageSize: limit,
    totalPages: Math.ceil(countResult.total / limit),
  }, '查询成功'));
});

router.put('/:id/read', (req: Request, res: Response) => {
  const { id } = req.params;

  const db = getDb();

  const notification = db.prepare('SELECT id FROM notifications WHERE id = ?').get(id);
  if (!notification) {
    return res.status(404).json(errorResponse('通知不存在', 404));
  }

  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);

  res.json(successResponse({ id }, '已标记为已读'));
});

router.post('/round-start', (req: Request, res: Response) => {
  const { tournament_id, round_id } = req.body;

  if (!tournament_id || !round_id) {
    return res.status(400).json(errorResponse('缺少必要参数: tournament_id, round_id', 400));
  }

  const db = getDb();

  const tournament = db.prepare('SELECT id, name FROM tournaments WHERE id = ?').get(tournament_id) as { id: string; name: string };
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  const round = db.prepare('SELECT id, round_number FROM rounds WHERE id = ? AND tournament_id = ?').get(round_id, tournament_id) as { id: string; round_number: number };
  if (!round) {
    return res.status(404).json(errorResponse('轮次不存在', 404));
  }

  const players = db.prepare(`
    SELECT id, name FROM players WHERE tournament_id = ?
  `).all(tournament_id) as { id: string; name: string }[];

  if (players.length === 0) {
    return res.status(400).json(errorResponse('没有找到选手', 400));
  }

  const insertStmt = db.prepare(`
    INSERT INTO notifications (
      id, tournament_id, round_id, type, title, content,
      target_type, target_id, is_read, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);

  const title = `第 ${round.round_number} 轮比赛开始`;
  const content = `${tournament.name} 第 ${round.round_number} 轮比赛现在开始，请各位选手前往指定座位就坐。`;

  const transaction = db.transaction(() => {
    for (const player of players) {
      insertStmt.run(
        generateId(),
        tournament_id,
        round_id,
        'round_start',
        title,
        content,
        'player',
        player.id,
        now()
      );
    }
  });

  transaction();

  res.json(successResponse({
    round_id,
    round_number: round.round_number,
    notified_count: players.length,
  }, '轮次开始通知已发送'));
});

router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  const db = getDb();

  const notification = db.prepare('SELECT id FROM notifications WHERE id = ?').get(id);
  if (!notification) {
    return res.status(404).json(errorResponse('通知不存在', 404));
  }

  db.prepare('DELETE FROM notifications WHERE id = ?').run(id);

  res.json(successResponse({ id }, '通知已删除'));
});

export default router;
