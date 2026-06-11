import { getDb } from './index';

const db = getDb();

console.log('数据库初始化完成');
console.log('数据库文件路径:', require('path').resolve(__dirname, '../../data/tournament.db'));

export default db;
