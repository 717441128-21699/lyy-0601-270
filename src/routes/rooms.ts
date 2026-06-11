import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { generateId, now, successResponse, errorResponse } from '../utils';

const router = Router();

interface Room {
  id: string;
  tournament_id: string;
  name: string;
  capacity: number;
  status: string;
  created_at: string;
}

router.post('/', (req: Request, res: Response) => {
  const { tournament_id, name, capacity } = req.body;

  if (!tournament_id || !name) {
    return res.status(400).json(errorResponse('tournament_id 和 name 为必填字段', 400));
  }

  const db = getDb();
  const tournament = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournament_id);
  if (!tournament) {
    return res.status(404).json(errorResponse('赛事不存在', 404));
  }

  const roomCapacity = capacity || 4;
  if (roomCapacity < 1) {
    return res.status(400).json(errorResponse('房间容量必须大于0', 400));
  }

  const id = generateId();
  const createdAt = now();

  db.prepare(`
    INSERT INTO rooms (id, tournament_id, name, capacity, status, created_at)
    VALUES (?, ?, ?, ?, 'available', ?)
  `).run(id, tournament_id, name, roomCapacity, createdAt);

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as Room;

  res.status(201).json(successResponse(room, '房间创建成功'));
});

router.get('/', (req: Request, res: Response) => {
  const { tournament_id } = req.query;

  if (!tournament_id) {
    return res.status(400).json(errorResponse('tournament_id 为必填参数', 400));
  }

  const db = getDb();

  const rooms = db.prepare(`
    SELECT * FROM rooms
    WHERE tournament_id = ?
    ORDER BY created_at ASC
  `).all(tournament_id) as Room[];

  res.json(successResponse(rooms, '查询成功'));
});

router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, capacity, status } = req.body;
  const db = getDb();

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as Room;
  if (!room) {
    return res.status(404).json(errorResponse('房间不存在', 404));
  }

  const updatedName = name !== undefined ? name : room.name;
  const updatedCapacity = capacity !== undefined ? capacity : room.capacity;
  const updatedStatus = status !== undefined ? status : room.status;

  if (updatedCapacity < 1) {
    return res.status(400).json(errorResponse('房间容量必须大于0', 400));
  }

  db.prepare(`
    UPDATE rooms
    SET name = ?, capacity = ?, status = ?
    WHERE id = ?
  `).run(updatedName, updatedCapacity, updatedStatus, id);

  const updatedRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as Room;

  res.json(successResponse(updatedRoom, '房间更新成功'));
});

router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!room) {
    return res.status(404).json(errorResponse('房间不存在', 404));
  }

  db.prepare('DELETE FROM rooms WHERE id = ?').run(id);

  res.json(successResponse(null, '房间删除成功'));
});

export default router;
