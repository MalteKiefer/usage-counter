import { app } from './app.js';
import { config } from './config.js';

const { port, host } = config;

app.listen(port, host, () => console.log(`API läuft auf http://${host}:${port}`));
