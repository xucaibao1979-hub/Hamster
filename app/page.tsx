import AssetsApp from './assets-app';
import { requireChatGPTUser } from './chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requireChatGPTUser('/');return <AssetsApp email={user.email}/>}
