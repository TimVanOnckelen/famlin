import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';

const uploadsDir = path.join(process.cwd(), 'uploads');

export default async function uploadRoutes(fastify: FastifyInstance) {
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const parts = request.parts();
    const uploadedUrls: string[] = [];

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename) || '.jpg';
        const filename = `${randomUUID()}${ext}`;
        const filepath = path.join(uploadsDir, filename);

        await pipeline(part.file, (await fs.open(filepath, 'w')).createWriteStream());

        const url = `/uploads/${filename}`;
        uploadedUrls.push(url);
      }
    }

    return { urls: uploadedUrls };
  });
}
