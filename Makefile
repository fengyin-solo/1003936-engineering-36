.PHONY: install frontend build preview test

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

preview:
	cd frontend && npm run preview

test:
	cd frontend && npm test
