# The viewer is a TypeScript app in ui/. The Go binary embeds its build, so the UI is built first.
BIN ?= hrev

.PHONY: build ui ui-deps test check clean

build: ui
	go build -o $(BIN) .

ui: ui-deps
	cd ui && npm run build

ui-deps: ui/node_modules/.package-lock.json

ui/node_modules/.package-lock.json: ui/package.json ui/package-lock.json
	cd ui && npm ci

test: ui
	cd ui && npm run check
	go vet ./...
	go test ./...

clean:
	rm -f $(BIN)
	find internal/web/dist -mindepth 1 ! -name README -delete
