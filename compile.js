var fs = require('fs');

var falafel = require('falafel');

function swapArgs (node) {
	var left = node.left;
	node.left = node.right;
	node.right = left;
}

function toBool (node) {
	var source = node.source();
	if (/^JS_BOOL\(/.test(source)) {
		return source.replace(/^JS_BOOL/, '');
	}
	return 'JSValue_BOOL(' + node.source() + ')';
}

function translate (src) {
	return falafel(String(src), function (node) {
		switch (node.type) {
			case 'Literal':
				switch (typeof node.value) {
					case 'number': node.update('JS_NUMBER(' + node.value + ')'); break;
					case 'string': node.update('JS_STRING(' + JSON.stringify(node.value) + ')'); break;
				}
				break;
			case 'BinaryExpression':
			case 'LogicalExpression':
				var prefix = '', middle = ', '; suffix = '';
				switch (node.operator) {
					case '+': prefix = 'JS_ADD('; suffix = ')'; break;
					case '-': prefix = 'JS_SUB('; suffix = ')'; break;
					case '*': prefix = 'JS_MUL('; suffix = ')'; break;
					case '/': prefix = 'JS_DIV('; suffix = ')'; break;
					case '%': prefix = 'JS_MOD('; suffix = ')'; break;
					case '==': prefix = 'JS_BOOL(JS_EQ('; suffix = '))'; break;
					case '!=': prefix = 'JS_BOOL(!JS_EQ('; suffix = '))'; break;
					case '<': prefix = 'JS_BOOL(JS_LT('; suffix = '))'; break;
					case '<=': prefix = 'JS_BOOL(!JS_LT('; suffix = '))'; swapArgs(node); break;
					case '>': prefix = 'JS_BOOL(JS_LT('; suffix = '))'; swapArgs(node); break;
					case '>=': prefix = 'JS_BOOL(!JS_LT('; suffix = '))'; break;
					case '||': prefix = 'JS_BOOL(JS_OR('; suffix = '))'; break;
					default: console.error('Unknown operator conversion:', node.operator);
				}
				node.update(prefix + node.left.source() + middle + node.right.source() + suffix)
				break;
			case 'AssignmentExpression':
				if (node.operator != '=') {
					node.update(node.left.source() + '.number ' + node.operator + ' ' + node.right.source() + '.number');
				}
				break;
			case 'UpdateExpression':
				node.update(node.argument.source() + '.number' + node.operator);
				break;
			case 'IfStatement':
				node.update('if (' + toBool(node.test) + ') ' + node.consequent.source() + (node.alternate ? ' else ' + node.alternate.source() : ''));
				break;
			case 'ForStatement':
				node.update(node.init.source() + '; for (; ' + toBool(node.test) + '; ' + node.update.source() + ') ' + node.body.source());
				break;
			case 'FunctionDeclaration':
				node.update('JS_DEFN(' + node.id.source() + ') {' + 
					(!node.params.length ? '' : 
						'\n\tVARGS(' + node.params.map(function (arg) { return 'VARG(' + arg.source() + ')'; }).join(' ') + ');') + 
					node.body.source().substr(1));
				break;
			case 'CallExpression':
				if (node.callee.type == 'MemberExpression') {
					node.update('JS_CALL_METHOD(' + [node.callee.object.source(), JSON.stringify(node.callee.property.source())].concat(node.arguments.map(function (arg) { return arg.source(); })).join(', ') + ')');
				} else {
					node.update('JS_CALL_FUNC(' + [node.callee.source()].concat(node.arguments.map(function (arg) { return arg.source(); })).join(', ') + ')');
				}
				break;
			case 'Program':
				node.update('#include "gum.h"\n\n' + node.source() + '\n\nint main() {\n\treturn js_main();\n}');
				break;
			case 'VariableDeclaration':
				node.update(node.source().replace(/^var\b/, 'JSValue'));
				break;
			case 'ObjectExpression':
				node.update('({ JSValue obj = JS_OBJECT(); ' +
					node.properties.map(function (prop) {
						return 'JS_SET_PROP(obj, ' + JSON.stringify(prop.key.source()) + ', ' + prop.value.source() + ');';
					}).join(' ') +
					' obj; })');
				break;
			case 'MemberExpression':
				if (node.parent.type != 'CallExpression' || node.parent.callee != node) {
					node.update('JS_GET_PROP(' + node.object.source() + ', ' + JSON.stringify(node.property.source()) + ')');
				}
				break;
			case 'Property':
			case 'BlockStatement':
			case 'ReturnStatement':
			case 'Identifier':
			case 'ExpressionStatement':
			case 'VariableDeclarator':
				break;
			default:
				console.error('Unknown node conversion:', node.type);
		}
	});
}

console.log(translate(fs.readFileSync('source.js')));