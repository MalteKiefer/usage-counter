import { app } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';

app.listen(port, host, () => console.log(`API läuft auf http://${host}:${port}`));
