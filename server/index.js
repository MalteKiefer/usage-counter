import { app } from './app.js';
import { initAuth } from './auth.js';
import { config } from './config.js';

const { port, host } = config;

await initAuth();
app.listen(port, host, () => console.log(`API listening on http://${host}:${port}`));
