import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { generateId, now, successResponse, errorResponse } from '../utils';

const router = Router();

interface Group {
  id: string;
  tournament_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

router.post('/', (req: Request, res: Response) => {
  const { tournament_id, name, description } = req.body;

  if (!tournament_id || !name) {
    return res.status(400).json(errorResponse('tournament_id 和 name 为必填字段', 400));
  }

  const db = getDb();
  const tournament = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournament_id);
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  const id = generateId();
  const createdAt = now();

  db.prepare(`
    INSERT INTO groups_table (id, tournament_id, name, description, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, tournament_id, name, description || null, createdAt);

  const group = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(id) as Group;

  res.status(201).json(successResponse(group, '分组创建成功'));
});

router.get('/', (req: Request, res: Response) => {
  const { tournament_id } = req.query;

  if (!tournament_id) {
    return res.status(400).json(errorResponse('tournament_id 为必填参数', 400));
  }

  const db = getDb();

  const groups = db.prepare(`
    SELECT * FROM groups_table
    WHERE tournament_id = ?
    ORDER BY created_at ASC
  `).all(tournament_id) as Group[];

  const groupsWithPlayerCount = groups.map(group => {
    const result = db.prepare('SELECT COUNT(*) as count FROM players WHERE group_id = ?').get(group.id) as { count: number };
    return {
      ...group,
      player_count: result.count
    };
  });

  res.json(successResponse(groupsWithPlayerCount, '查询成功'));
});

router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description } = req.body;
  const db = getDb();

  const group = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(id) as Group;
  if (!group) {
    return res.status(404).json(errorResponse('分组不存在', 404));
  }

  const updatedName = name !== undefined ? name : group.name;
  const updatedDescription = description !== undefined ? description : group.description;

  db.prepare(`
    UPDATE groups_table
    SET name = ?, description = ?
    WHERE id = ?
  `).run(updatedName, updatedDescription, id);

  const updatedGroup = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(id) as Group;

  res.json(successResponse(updatedGroup, '分组更新成功'));
});

router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const group = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(id);
  if (!group) {
    return res.status(404).json(errorResponse('分组不存在', 404));
  }

  db.prepare('DELETE FROM groups_table WHERE id = ?').run(id);

  res.json(successResponse(null, '分组删除成功'));
});

export default router;
