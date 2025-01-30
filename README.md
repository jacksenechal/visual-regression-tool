# Visual Regression Tool

A CLI tool for automated visual regression testing of web apps. It performs depth-first traversal on two instances of a web app, captures screenshots at each step, and compares the results for visual and structural differences.

## Features
- Depth-first traversal of web apps.
- Screenshot comparison using `pixelmatch`.
- JUnit XML report generation for CI integration.
- Temporary directory for storing artifacts (screenshots, diffs, reports).

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/visual-regression-tool.git
   cd visual-regression-tool
   ```

2. Install dependencies:
   ```bash
   make install
   ```

## Usage

Run the tool with two instances of your web app:
```bash
make run INSTANCE_A=http://instance-a.com INSTANCE_B=http://instance-b.com
```

Or directly with `npm`:
```bash
npm start -- http://instance-a.com http://instance-b.com
```

## Commands

- `make install`: Install dependencies.
- `make run`: Run the tool.
- `make lint`: Lint the code.
- `make clean`: Clean temporary files.
- `make all`: Install, lint, and run the tool.

## Output

- **JUnit Report**: `./tmp/report.xml`
- **Screenshots**: `./tmp/screenshots/`
- **Diffs**: `./tmp/diffs/`

## License

MIT
