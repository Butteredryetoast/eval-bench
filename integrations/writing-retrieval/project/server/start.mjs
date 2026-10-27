import { createApiServer } from './api.mjs';

try { process.loadEnvFile?.(); } catch { /* .env is optional */ }
const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '127.0.0.1';
const server = await createApiServer();
server.listen(port, host, () => console.log(`Writing workflow API listening at http://${host}:${port}`));
