import {randomBytes,scryptSync,timingSafeEqual,randomUUID} from 'node:crypto';
export function initUsers(db,bootstrapPassword,bootstrapEmail,bootstrapUsername='admin'){
 db.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, salt TEXT NOT NULL, hash TEXT NOT NULL, created TEXT NOT NULL);');
 if(db.prepare('SELECT COUNT(*) AS n FROM users').get().n===0){checkPassword(bootstrapPassword);const {salt,hash}=hashPassword(bootstrapPassword);db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),bootstrapUsername.toLowerCase(),'管理员',bootstrapEmail,'admin',1,salt,hash,new Date().toISOString())}
}
function checkPassword(password){if(typeof password!=='string'||password.length<12||password.length>128)throw new Error('密码长度需为 12–128 位')}
function hashPassword(password){checkPassword(password);const salt=randomBytes(32).toString('hex');return {salt,hash:scryptSync(password,salt,64).toString('hex')}}
export function verifyPassword(row,password){if(!row||typeof password!=='string'||password.length>128)return false;return timingSafeEqual(scryptSync(password,row.salt,64),Buffer.from(row.hash,'hex'))}
export function publicUser(row){return row?{id:row.id,username:row.username,name:row.name,email:row.email,role:row.role,enabled:!!row.enabled,created:row.created}:null}
export function userList(db){return db.prepare('SELECT * FROM users ORDER BY created').all().map(publicUser)}
export function userCommand(db,c,current){
 const get=id=>typeof id==='string'?db.prepare('SELECT * FROM users WHERE id=?').get(id):null;const target=c.action==='changePassword'?get(current.id):get(c.id);
 if(c.action==='changePassword'){
  if(!verifyPassword(target,c.currentPassword))throw new Error('当前密码错误');const {salt,hash}=hashPassword(c.password);db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hash,current.id);return {targetId:current.id,detail:`${current.username} 修改密码`,keepCurrent:true};
 }
 if(current.role!=='admin')throw new Error('仅管理员可管理用户');
 if(c.action==='resetPassword'){if(!target)throw new Error('用户不存在');const {salt,hash}=hashPassword(c.password);db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hash,target.id);return {targetId:target.id,detail:`重置 ${target.username} 的密码`}}
 if(!['add','update'].includes(c.action))throw new Error('用户操作无效');
 const name=String(c.name||'').trim(),email=String(c.email||'').trim();if(!name||name.length>80)throw new Error('姓名需为 1–80 字');if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('邮箱格式错误');if(!['admin','viewer'].includes(c.role))throw new Error('角色无效');
 if(c.action==='add'){
  const username=String(c.username||'').trim().toLowerCase();if(!/^[a-z0-9_.@\-]{3,100}$/.test(username))throw new Error('账号需为 3–100 位字母、数字、邮箱或 . _ -');if(db.prepare('SELECT id FROM users WHERE username=?').get(username))throw new Error('账号已存在');const {salt,hash}=hashPassword(c.password);const id=randomUUID();db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run(id,username,name,email,c.role,1,salt,hash,new Date().toISOString());return {targetId:id,detail:`新增用户 ${username}`};
 }
 if(!target)throw new Error('用户不存在');const enabled=c.enabled===false?0:1;
 const username=String(c.username||target.username).trim().toLowerCase();if(!/^[a-z0-9_.@\-]{3,100}$/.test(username))throw new Error('账号格式无效');if(db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username,target.id))throw new Error('账号已存在');
 if(target.id===current.id&&!enabled)throw new Error('不能停用当前登录账号');
 if(target.role==='admin'&&target.enabled&&(!enabled||c.role!=='admin')&&db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND enabled=1").get().n<=1)throw new Error('必须保留至少一名启用的管理员');
 db.prepare('UPDATE users SET username=?,name=?,email=?,role=?,enabled=? WHERE id=?').run(username,name,email,c.role,enabled,target.id);
 return {targetId:target.id,detail:`修改用户 ${target.username}`,keepCurrent:target.id===current.id&&c.role===target.role&&!!enabled};
}



