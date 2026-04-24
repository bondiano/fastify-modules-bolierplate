import type { ModuleNames } from '../util/names.ts';

export const serviceSpecTemplate = ({
  plural,
  singular,
}: ModuleNames): string => `import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ${singular.pascal}NotFound } from '../errors/${singular.kebab}-not-found.error.ts';
import type { ${plural.pascal}Repository } from '../${plural.kebab}.repository.ts';
import { create${plural.pascal}Service } from '../${plural.kebab}.service.ts';

type ${singular.pascal} = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

const sample${singular.pascal}: ${singular.pascal} = {
  id: '${singular.kebab}-1',
  name: 'Sample',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
};

const createFakeRepository = () => {
  const repo = {
    findById: vi.fn(),
    findFiltered: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
  };
  return repo as unknown as ${plural.pascal}Repository & typeof repo;
};

describe('create${plural.pascal}Service', () => {
  let ${plural.camel}Repository: ReturnType<typeof createFakeRepository>;
  let service: ReturnType<typeof create${plural.pascal}Service>;

  beforeEach(() => {
    ${plural.camel}Repository = createFakeRepository();
    service = create${plural.pascal}Service({ ${plural.camel}Repository });
  });

  describe('findById', () => {
    it('returns the ${singular.kebab} when found', async () => {
      ${plural.camel}Repository.findById.mockResolvedValue(sample${singular.pascal});
      await expect(service.findById('${singular.kebab}-1')).resolves.toEqual(
        sample${singular.pascal},
      );
      expect(${plural.camel}Repository.findById).toHaveBeenCalledWith(
        '${singular.kebab}-1',
      );
    });

    it('throws ${singular.pascal}NotFound when the repo returns null', async () => {
      ${plural.camel}Repository.findById.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toBeInstanceOf(
        ${singular.pascal}NotFound,
      );
    });
  });

  describe('create', () => {
    it('delegates to the repository', async () => {
      ${plural.camel}Repository.create.mockResolvedValue(sample${singular.pascal});
      await service.create({ name: 'Sample' });
      expect(${plural.camel}Repository.create).toHaveBeenCalledWith({
        name: 'Sample',
      });
    });
  });

  describe('update', () => {
    it('stamps updatedAt and returns the updated ${singular.kebab}', async () => {
      ${plural.camel}Repository.update.mockResolvedValue({
        ...sample${singular.pascal},
        name: 'Renamed',
      });

      const result = await service.update('${singular.kebab}-1', {
        name: 'Renamed',
      });

      expect(result.name).toBe('Renamed');
      expect(${plural.camel}Repository.update).toHaveBeenCalledWith(
        '${singular.kebab}-1',
        expect.objectContaining({
          name: 'Renamed',
          updatedAt: expect.any(String),
        }),
      );
    });

    it('throws ${singular.pascal}NotFound when the repo returns null', async () => {
      ${plural.camel}Repository.update.mockResolvedValue(null);
      await expect(
        service.update('missing', { name: 'x' }),
      ).rejects.toBeInstanceOf(${singular.pascal}NotFound);
    });
  });

  describe('deleteById', () => {
    it('returns the deleted ${singular.kebab}', async () => {
      ${plural.camel}Repository.deleteById.mockResolvedValue(sample${singular.pascal});
      await expect(service.deleteById('${singular.kebab}-1')).resolves.toEqual(
        sample${singular.pascal},
      );
    });

    it('throws ${singular.pascal}NotFound when the repo returns null', async () => {
      ${plural.camel}Repository.deleteById.mockResolvedValue(null);
      await expect(service.deleteById('missing')).rejects.toBeInstanceOf(
        ${singular.pascal}NotFound,
      );
    });
  });
});
`;

export const routeSpecTemplate = ({
  plural,
}: ModuleNames): string => `import { describe, expect, it } from 'vitest';

import { setupIntegrationTest } from '#__tests__/helpers/setup-integration-test.ts';

describe('${plural.pascal} routes', () => {
  const { server: app } = setupIntegrationTest();

  describe('GET /api/v1/${plural.kebab}', () => {
    it('returns an empty paginated list when no ${plural.kebab} exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/${plural.kebab}?page=1&limit=20',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.error).toBeNull();
      expect(body.data.items).toEqual([]);
      expect(body.data.pagination.total).toBe(0);
    });
  });

  describe('GET /api/v1/${plural.kebab}/:id', () => {
    it('returns 404 with the error envelope when missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/${plural.kebab}/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.data).toBeNull();
      expect(body.error.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/${plural.kebab}', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/${plural.kebab}',
        payload: { name: 'sample' },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
`;
