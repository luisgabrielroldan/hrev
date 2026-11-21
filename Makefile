# The viewer is a TypeScript app in ui/. The Go binary embeds its build, so the UI is built first.
BIN ?= hrev
# The version that `hrev version` prints. A release build gets the tag, such as v1.2.3. Other builds get the
# output of git describe, such as v1.2.3-4-gabc1234-dirty.
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
# The platforms of a release. hrev uses flock, so Windows is not a target.
PLATFORMS := darwin/amd64 darwin/arm64 linux/amd64 linux/arm64

.PHONY: build ui ui-deps test e2e coverage dist clean

build: ui
	go build -ldflags '$(LDFLAGS)' -o $(BIN) .

ui: ui-deps
	cd ui && npm run build

ui-deps: ui/node_modules/.package-lock.json

ui/node_modules/.package-lock.json: ui/package.json ui/package-lock.json
	cd ui && npm ci

test: ui
	cd ui && npm run check
	go vet ./...
	go test ./...

# Browser tests of the viewer against the real binary. They use the installed Google Chrome (see ui/playwright.config.ts).
e2e: build
	cd ui && npm run e2e

# Coverage of the unit tests, the CLI test and the browser tests together. The binary is built with -cover, so
# every run of it records coverage; the viewer is built with a source map, so browser coverage maps back to the
# TypeScript files. The report is in .coverage/. The last step builds the normal binary again.
coverage: ui-deps
	rm -rf .coverage
	mkdir -p .coverage/go .coverage/unit .coverage/all
	cd ui && HREV_COVERAGE=1 npm run build
	go build -cover -o $(BIN) .
	go test -cover ./... -args -test.gocoverdir=$(CURDIR)/.coverage/unit > /dev/null
	HREV_BIN=$(CURDIR)/$(BIN) GOCOVERDIR=$(CURDIR)/.coverage/go go test -count=1 -run TestWatcherCycleThroughCLI . > /dev/null
	cd ui && GOCOVERDIR=$(CURDIR)/.coverage/go HREV_JS_COVERAGE=$(CURDIR)/.coverage/js npx playwright test > /dev/null
	go tool covdata merge -i=.coverage/unit,.coverage/go -o=.coverage/all
	@echo "== Go: unit tests only"; go tool covdata percent -i=.coverage/unit
	@echo "== Go: unit tests + CLI test + browser tests"; go tool covdata percent -i=.coverage/all
	@echo "== Viewer (TypeScript), browser tests"; node -e "const s=require('./.coverage/js/coverage-summary.json').total; for (const k of ['lines','statements','functions','branches']) console.log(k.padEnd(11), s[k].pct + '%')"
	$(MAKE) build > /dev/null

# Release archives for all platforms, and their checksums, in dist/. The release workflow runs this target.
dist: ui
	rm -rf dist
	mkdir -p dist
	@set -e; for p in $(PLATFORMS); do \
		os=$${p%/*}; arch=$${p#*/}; name=hrev_$(VERSION)_$${os}_$${arch}; \
		echo "== $$name"; \
		mkdir -p dist/$$name; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags '$(LDFLAGS)' -o dist/$$name/hrev .; \
		cp LICENSE README.md dist/$$name/; \
		tar -C dist -czf dist/$$name.tar.gz $$name; \
		rm -rf dist/$$name; \
	done
	cd dist && shasum -a 256 *.tar.gz > checksums.txt

clean:
	rm -rf $(BIN) dist
	find internal/web/dist -mindepth 1 ! -name README -delete
