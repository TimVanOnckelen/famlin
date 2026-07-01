import { FastifyInstance } from 'fastify';
import { getAlbum, getSharedAlbums, proxyAsset, type ImmichAlbum } from '../services/immich.js';

function transformAlbum(album: ImmichAlbum) {
  return {
    id: album.id,
    name: album.albumName,
    description: album.description,
    thumbnailAssetId: album.albumThumbnailAssetId,
    assetCount: album.assets.length,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  };
}

function transformAsset(asset: any) {
  return {
    id: asset.id,
    type: asset.type,
    fileName: asset.originalFileName,
    createdAt: asset.createdAt,
    description: asset.exifInfo?.description || null,
  };
}

export default async function immichRoutes(fastify: FastifyInstance) {
  fastify.get('/albums', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
    try {
      const albums = await getSharedAlbums();
      return albums.map(transformAlbum);
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'Failed to fetch albums' });
    }
  });

  fastify.get('/albums/:albumId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { albumId } = request.params as { albumId: string };

    try {
      const album = await getAlbum(albumId);
      return {
        ...transformAlbum(album),
        assets: album.assets.map(transformAsset),
      };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'Failed to fetch album' });
    }
  });

  fastify.get('/assets/:assetId/:type', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { assetId, type } = request.params as { assetId: string; type: string };

    if (!['thumbnail', 'original', 'webp'].includes(type)) {
      return reply.status(400).send({ error: 'Invalid asset type' });
    }

    try {
      const { buffer, contentType } = await proxyAsset(assetId, type as any);
      return reply.type(contentType).send(buffer);
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'Failed to fetch asset' });
    }
  });
}
