import { preview } from 'vite';
export default async function setup() {
  const server = await preview({ preview: { host: '127.0.0.1', port: 4187, strictPort: true, open: false } });
  return async () => {
    server.httpServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.httpServer.close(e => e ? reject(e) : resolve()));
  };
}
