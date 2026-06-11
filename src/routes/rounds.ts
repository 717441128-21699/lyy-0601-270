import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { generateId, now, successResponse, errorResponse } from '../utils';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { tournament_id, round_number } = req.body;

  if (!tournament_id) {
    return res.status(400).json(errorResponse('赛事ID不能为空', 400));
  }
  if (round_number === undefined || round_number === null) {
    return res.status(400).json(errorResponse('轮次号不能为空', 400));
  }
  if (typeof round_number !== 'number' || round_number < 1) {
    return res.status(400).json(errorResponse('轮次号必须为大于0的数字', 400));
  }

  const db = getDb();

  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament_id);
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  const existingRound = db.prepare(
    'SELECT * FROM rounds WHERE tournament_id = ? AND round_number = ?'
  ).get(tournament_id, round_number);
  if (existingRound) {
    return res.status(400).json(errorResponse('该赛事下已存在相同轮次号的轮次', 400));
  }

  const id = generateId();
  const currentTime = now();

  const stmt = db.prepare(`
    INSERT INTO rounds (id, tournament_id, round_number, status, start_time, end_time, created_at)
    VALUES (?, ?, ?, 'pending', NULL, NULL, ?)
  `);
  stmt.run(id, tournament_id, round_number, currentTime);

  const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
  res.json(successResponse(round, '创建轮次成功'));
});

router.get('/', (req: Request, res: Response) => {
  const { tournament_id } = req.query;
  const db = getDb();

  let whereClauses: string[] = [];
  let params: any[] = [];

  if (tournament_id) {
    whereClauses.push('tournament_id = ?');
    params.push(tournament_id);
  }

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const list = db.prepare(`
    SELECT * FROM rounds ${whereSql}
    ORDER BY tournament_id, round_number ASC
  `).all(...params);

  res.json(successResponse(list, '查询轮次列表成功'));
});

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
  if (!round) {
    return res.status(404).json(errorResponse('轮次不存在', 404));
  }

  res.json(successResponse(round, '查询轮次详情成功'));
});

router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { round_number, status } = req.body;
  const db = getDb();

  const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(id) as any;
  if (!round) {
    return res.status(404).json(errorResponse('轮次不存在', 404));
  }

  let updateFields: string[] = [];
  let params: any[] = [];

  if (round_number !== undefined) {
    if (typeof round_number !== 'number' || round_number < 1) {
      return res.status(400).json(errorResponse('轮次号必须为大于0的数字', 400));
    }
    const existingRound = db.prepare(
      'SELECT * FROM rounds WHERE tournament_id = ? AND round_number = ? AND id != ?'
    ).get(round.tournament_id, round_number, id);
    if (existingRound) {
      return res.status(400).json(errorResponse('该赛事下已存在相同轮次号的轮次', 400));
    }
    updateFields.push('round_number = ?');
    params.push(round_number);
  }

  if (status !== undefined) {
    const validStatuses = ['pending', 'ongoing', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json(errorResponse('无效的轮次状态', 400));
    }
    updateFields.push('status = ?');
    params.push(status);
  }

  if (updateFields.length === 0) {
    return res.status(400).json(errorResponse('没有需要更新的字段', 400));
  }

  params.push(id);
  const updateSql = `UPDATE rounds SET ${updateFields.join(', ')} WHERE id = ?`;
  db.prepare(updateSql).run(...params);

  const updated = db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
  res.json(successResponse(updated, '更新轮次成功'));
});

router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
  if (!round) {
    return res.status(404).json(errorResponse('轮次不存在', 404));
  }

  db.prepare('DELETE FROM rounds WHERE id = ?').run(id);
  res.json(successResponse(null, '删除轮次成功'));
});

router.put('/:id/start', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(id) as any;
  if (!round) {
    return res.status(404).json(errorResponse('轮次不存在', 404));
  }
  if (round.status !== 'pending') {
    return res.status(400).json(errorResponse('只有待开始的轮次才能开始', 400));
  }

  const currentTime = now();
  db.prepare(`
    UPDATE rounds SET status = 'ongoing', start_time = ? WHERE id = ?
  `).run(currentTime, id);

  const updated = db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
  res.json(successResponse(updated, '轮次已开始'));
});

router.put('/:id/end', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(id) as any;
  if (!round) {
    return res.status(404).json(errorResponse('轮次不存在', 404));
  }
  if (round.status !== 'ongoing') {
    return res.status(400).json(errorResponse('只有进行中的轮次才能结束', 400));
  }

  const currentTime = now();
  db.prepare(`
    UPDATE rounds SET status = 'completed', end_time = ? WHERE id = ?
  `).run(currentTime, id);

  const updated = db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
  res.json(successResponse(updated, '轮次已结束'));
});

export default router;
