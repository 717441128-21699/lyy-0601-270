import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { generateId, now, successResponse, errorResponse, paginate } from '../utils';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { name, description, total_rounds, is_test } = req.body;

  if (!name) {
    return res.status(400).json(errorResponse('赛事名称不能为空', 400));
  }
  if (total_rounds === undefined || total_rounds === null) {
    return res.status(400).json(errorResponse('总轮次数不能为空', 400));
  }
  if (typeof total_rounds !== 'number' || total_rounds < 1) {
    return res.status(400).json(errorResponse('总轮次数必须为大于0的数字', 400));
  }

  const db = getDb();
  const id = generateId();
  const currentTime = now();
  const isTest = is_test ? 1 : 0;

  const stmt = db.prepare(`
    INSERT INTO tournaments (id, name, description, status, total_rounds, current_round, created_at, updated_at, is_test)
    VALUES (?, ?, ?, 'pending', ?, 0, ?, ?, ?)
  `);
  stmt.run(id, name, description || null, total_rounds, currentTime, currentTime, isTest);

  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  res.json(successResponse(tournament, '创建赛事成功'));
});

router.get('/', (req: Request, res: Response) => {
  const { status, page = 1, pageSize = 20, is_test } = req.query;
  const { limit, offset } = paginate(Number(page), Number(pageSize));

  const db = getDb();
  let whereClauses: string[] = [];
  let params: any[] = [];

  if (status) {
    whereClauses.push('status = ?');
    params.push(status);
  }
  if (is_test !== undefined) {
    whereClauses.push('is_test = ?');
    params.push(is_test === 'true' || is_test === '1' ? 1 : 0);
  }

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM tournaments ${whereSql}`);
  const total = (countStmt.get(...params) as any).total;

  const listStmt = db.prepare(`
    SELECT * FROM tournaments ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);
  const list = listStmt.all(...params, limit, offset);

  res.json(successResponse({
    list,
    total,
    page: Number(page),
    pageSize: limit
  }, '查询赛事列表成功'));
});

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  res.json(successResponse(tournament, '查询赛事详情成功'));
});

router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, total_rounds, status, is_test } = req.body;
  const db = getDb();

  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  const currentTime = now();
  let updateFields: string[] = [];
  let params: any[] = [];

  if (name !== undefined) {
    updateFields.push('name = ?');
    params.push(name);
  }
  if (description !== undefined) {
    updateFields.push('description = ?');
    params.push(description);
  }
  if (total_rounds !== undefined) {
    if (typeof total_rounds !== 'number' || total_rounds < 1) {
      return res.status(400).json(errorResponse('总轮次数必须为大于0的数字', 400));
    }
    updateFields.push('total_rounds = ?');
    params.push(total_rounds);
  }
  if (status !== undefined) {
    const validStatuses = ['pending', 'running', 'finished', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json(errorResponse('无效的赛事状态', 400));
    }
    updateFields.push('status = ?');
    params.push(status);
  }
  if (is_test !== undefined) {
    updateFields.push('is_test = ?');
    params.push(is_test ? 1 : 0);
  }

  if (updateFields.length === 0) {
    return res.status(400).json(errorResponse('没有需要更新的字段', 400));
  }

  updateFields.push('updated_at = ?');
  params.push(currentTime, id);

  const updateSql = `UPDATE tournaments SET ${updateFields.join(', ')} WHERE id = ?`;
  db.prepare(updateSql).run(...params);

  const updated = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  res.json(successResponse(updated, '更新赛事成功'));
});

router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  db.prepare('DELETE FROM tournaments WHERE id = ?').run(id);
  res.json(successResponse(null, '删除赛事成功'));
});

router.put('/:id/start', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as any;
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }
  if (tournament.status !== 'pending') {
    return res.status(400).json(errorResponse('只有待开始的赛事才能开始', 400));
  }

  const currentTime = now();
  db.prepare(`
    UPDATE tournaments SET status = 'running', updated_at = ? WHERE id = ?
  `).run(currentTime, id);

  const updated = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  res.json(successResponse(updated, '赛事已开始'));
});

router.put('/:id/finish', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as any;
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }
  if (tournament.status !== 'running') {
    return res.status(400).json(errorResponse('只有进行中的赛事才能结束', 400));
  }

  const currentTime = now();
  db.prepare(`
    UPDATE tournaments SET status = 'finished', updated_at = ? WHERE id = ?
  `).run(currentTime, id);

  const updated = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  res.json(successResponse(updated, '赛事已结束'));
});

router.post('/:id/clean-test-data', (req: Request, res: Response) => {
  const { id } = req.params;
  const { all } = req.body;
  const db = getDb();

  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as any;
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  if (all) {
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(id);
    return res.json(successResponse(null, '赛事及所有相关数据已清理'));
  }

  if (!tournament.is_test) {
    return res.status(400).json(errorResponse('该赛事不是测试数据，如需全部清理请使用 all 参数', 400));
  }

  db.prepare('DELETE FROM tournaments WHERE id = ? AND is_test = 1').run(id);
  res.json(successResponse(null, '测试数据已清理'));
});

export default router;
