# Fastify SaaS Kit -- one-shot developer onboarding.
#
# `make setup` takes a fresh clone from zero to a running, migrated API.
# Every target just wraps the underlying pnpm / docker commands -- nothing
# here is required, but it keeps the quick-start deterministic.

SHELL := /bin/bash

EMAIL    ?= admin@example.com
PASSWORD ?= change-me-please-1234

.PHONY: help setup env install up down reset migrate migration admin dev build \
        test lint typecheck check clean

help:
	@echo "Fastify SaaS Kit -- common targets:"
	@echo ""
	@echo "  make setup              Install + docker + migrate (one-shot onboarding)"
	@echo "  make dev                Start all services in watch mode"
	@echo ""
	@echo "  make env                Copy .env.example to .env (no-op if .env exists)"
	@echo "  make install            pnpm install"
	@echo "  make up                 docker compose up -d"
	@echo "  make down               docker compose down"
	@echo "  make reset              docker compose down -v && make setup"
	@echo "  make migrate            Run pending db migrations"
	@echo "  make migration name=x   Scaffold a new migration named x"
	@echo "  make admin              Create an admin user"
	@echo "                          (override EMAIL=... PASSWORD=...)"
	@echo ""
	@echo "  make build              Build all packages"
	@echo "  make test               Run all tests"
	@echo "  make lint               Run ESLint across the workspace"
	@echo "  make typecheck          tsc --noEmit across the workspace"
	@echo "  make check              lint + typecheck + test + build"
	@echo "  make clean              Remove build artifacts and node_modules"

setup: env install up migrate
	@echo ""
	@echo "Setup complete. Next steps:"
	@echo "  make admin EMAIL=you@example.com PASSWORD=<min-8-chars>"
	@echo "  make dev"

env:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "-> Created .env from .env.example"; \
	else \
		echo "-> .env already exists (leaving untouched)"; \
	fi

install:
	pnpm install

up:
	docker compose up -d

down:
	docker compose down

reset:
	docker compose down -v
	$(MAKE) setup

migrate:
	pnpm --filter api db:migrate

migration:
	@if [ -z "$(name)" ]; then \
		echo "Usage: make migration name=<migration_name>"; exit 1; \
	fi
	pnpm --filter api db:create-migration $(name)

admin:
	pnpm --filter api create-admin --email "$(EMAIL)" --password "$(PASSWORD)"

dev:
	pnpm dev

build:
	pnpm build

test:
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm check-types

check: lint typecheck test build

clean:
	pnpm clean
