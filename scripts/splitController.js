const fs = require('fs');
const path = require('path');

function splitController(controllerPath, outputDir) {
  const content = fs.readFileSync(controllerPath, 'utf8');
  
  // Extract imports at the top
  const importMatches = content.match(/^(const|require|import).*$/gm) || [];
  const imports = importMatches.slice(0, 20).join('\n'); // Get first 20 lines of imports
  
  // Find all function definitions
  const functionRegex = /^(\/\*\*[\s\S]*?\*\/\s*)?const\s+(\w+)\s*=\s*asyncHandler\(async\s*\(req,\s*res\)\s*=>\s*\{([\s\S]*?)^\}\);/gm;
  
  const functions = [];
  let match;
  
  while ((match = functionRegex.exec(content)) !== null) {
    const [fullMatch, jsdoc, functionName, functionBody] = match;
    functions.push({
      name: functionName,
      jsdoc: jsdoc || '',
      body: functionBody,
      fullMatch: fullMatch
    });
  }
  
  // Extract module.exports
  const exportsMatch = content.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
  const exportedFunctions = exportsMatch ? 
    exportsMatch[1].split(',').map(f => f.trim()).filter(f => f) : 
    functions.map(f => f.name);
  
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Write each function to its own file
  functions.forEach(func => {
    const fileName = `${func.name}.js`;
    const filePath = path.join(outputDir, fileName);
    
    // Determine which imports are needed (simple heuristic)
    const neededImports = imports.split('\n').filter(imp => {
      const importName = imp.match(/const\s+(\w+)/)?.[1];
      return importName && (func.fullMatch.includes(importName) || 
             ['asyncHandler', 'require'].includes(importName));
    }).join('\n');
    
    const fileContent = `${neededImports}\n\nconst ${func.name} = asyncHandler(async (req, res) => {${func.body}\n});\n\nmodule.exports = ${func.name};\n`;
    
    fs.writeFileSync(filePath, fileContent);
    console.log(`Created: ${fileName}`);
  });
  
  // Create index.js
  const indexContent = exportedFunctions.map(name => 
    `const ${name} = require('./${name}');`
  ).join('\n') + '\n\nmodule.exports = {\n  ' + 
    exportedFunctions.join(',\n  ') + '\n};\n';
  
  fs.writeFileSync(path.join(outputDir, 'index.js'), indexContent);
  console.log('Created: index.js');
  
  return functions.length;
}

// Usage
const controllerPath = process.argv[2];
const outputDir = process.argv[3];

if (!controllerPath || !outputDir) {
  console.log('Usage: node splitController.js <controllerPath> <outputDir>');
  process.exit(1);
}

const count = splitController(controllerPath, outputDir);
console.log(`\nSplit ${count} functions into separate files`);
