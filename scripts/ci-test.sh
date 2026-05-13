#!/bin/bash

# CI/CD Local Test Script
# Use this to verify quality checks before pushing

echo "🚀 Starting Local Quality Gate Simulation..."

mkdir -p reports

echo "🧐 Running ESLint..."
npm run lint:report
echo "✨ Running Prettier..."
npm run format:check
echo "📦 Running NPM Audit..."
npm run audit:report
echo "🧪 Running Unit Tests..."
npm run test:report

echo "✅ Local checks complete. Check the 'reports' directory for details."
