# Makefile for Visual Regression Tool

# Install dependencies
install:
	npm install
	npx playwright install
	sudo npx playwright install-deps

# Run the tool
run:
	npm start

# Lint the code
lint:
	npm run lint

# Clean temporary files
clean:
	npm run clean

# Start the results server
serve:
	npm run serve
