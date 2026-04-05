#!/usr/bin/env python3
import re
import os
import sys

def extract_imports(content):
    """Extract all require/import statements from the beginning of the file"""
    lines = content.split('\n')
    imports = []
    for line in lines[:30]:  # Check first 30 lines
        if line.strip().startswith(('const ', 'require', 'import', 'const{', 'const {')):
            if '= require(' in line or 'import ' in line:
                # Fix relative paths for subdirectory
                fixed_line = line.replace('require("../', 'require("../../')
                fixed_line = fixed_line.replace("require('../", "require('../../")
                imports.append(fixed_line)
    return '\n'.join(imports)

def extract_functions(content):
    """Extract all async handler functions"""
    # Pattern to match function definitions
    pattern = r'((?:\/\*\*[\s\S]*?\*\/\s*)?const\s+(\w+)\s*=\s*asyncHandler\(async\s*\(req,\s*res\)\s*=>\s*\{)([\s\S]*?)^\}\);'
    
    functions = []
    for match in re.finditer(pattern, content, re.MULTILINE):
        jsdoc_and_def = match.group(1)
        func_name = match.group(2)
        func_body = match.group(3)
        
        functions.append({
            'name': func_name,
            'definition': jsdoc_and_def,
            'body': func_body,
            'full': match.group(0)
        })
    
    return functions

def extract_exports(content):
    """Extract module.exports"""
    match = re.search(r'module\.exports\s*=\s*\{([^}]+)\}', content, re.DOTALL)
    if match:
        exports_str = match.group(1)
        # Split by comma and clean up
        exports = [e.strip().rstrip(',') for e in exports_str.split(',') if e.strip()]
        return exports
    return []

def create_function_file(func_name, func_def, func_body, imports, output_dir):
    """Create a separate file for each function"""
    filename = f"{func_name}.js"
    filepath = os.path.join(output_dir, filename)
    
    content = f"""{imports}

{func_def}{func_body}
}});

module.exports = {func_name};
"""
    
    with open(filepath, 'w') as f:
        f.write(content)
    
    print(f"Created: {filename}")

def create_index_file(exports, output_dir):
    """Create index.js that exports all functions"""
    requires = '\n'.join([f"const {name} = require('./{name}');" for name in exports])
    exports_str = ',\n  '.join(exports)
    
    content = f"""{requires}

module.exports = {{
  {exports_str}
}};
"""
    
    with open(os.path.join(output_dir, 'index.js'), 'w') as f:
        f.write(content)
    
    print("Created: index.js")

def split_controller(controller_path, output_dir):
    """Main function to split controller"""
    with open(controller_path, 'r') as f:
        content = f.read()
    
    # Extract components
    imports = extract_imports(content)
    functions = extract_functions(content)
    exports = extract_exports(content)
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Create individual function files
    for func in functions:
        create_function_file(
            func['name'],
            func['definition'],
            func['body'],
            imports,
            output_dir
        )
    
    # Create index file
    if exports:
        create_index_file(exports, output_dir)
    else:
        create_index_file([f['name'] for f in functions], output_dir)
    
    print(f"\nSplit {len(functions)} functions into separate files")
    return len(functions)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python3 split_controller.py <controller_path> <output_dir>")
        sys.exit(1)
    
    controller_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    split_controller(controller_path, output_dir)
