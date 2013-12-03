#include "gum.h"

const JSValue JS_UNDEF = ((JSValue) {JS_UNDEFINED_TAG});
const JSValue JS_NULL = ((JSValue) {JS_NULL_TAG});

char *JSValue_STR (JSValue val) {
	switch (val.tag) {
		case JS_NUMBER_TAG: return HPRINTF("%f", val.number);
		case JS_STRING_TAG: return HPRINTF("%s", val.string);
		case JS_BOOL_TAG: return HPRINTF("%s", val.boolean ? "true" : "false");
		case JS_OBJECT_TAG: return HPRINTF("[object Object]");
		case JS_FUNCTION_TAG: return HPRINTF("[function]");
		case JS_NULL_TAG: return "null";
		case JS_UNDEFINED_TAG: return "undefined";
		default: return "null";
	}
}

double JSValue_NUMBER (JSValue val) {
	switch (val.tag) {
		case JS_NUMBER_TAG: return val.number;
		case JS_BOOL_TAG: return val.boolean ? 1 : 0;
		default: return NAN;
	}
}

bool JSValue_BOOL (JSValue val) {
	switch (val.tag) {
		case JS_NUMBER_TAG: return val.number != 0;
		case JS_STRING_TAG: return strlen(val.string);
		case JS_BOOL_TAG: return val.boolean;
		case JS_OBJECT_TAG: return true;
		case JS_FUNCTION_TAG: return true;
		case JS_NULL_TAG: return false;
		case JS_UNDEFINED_TAG: return false;
		default: return true;
	}
}

JS_LT_VARIANT(NUMBER_NUMBER, a.tag == JS_NUMBER_TAG && b.tag == JS_NUMBER_TAG, a.number < b.number, JSValue_NUMBER(a) < JSValue_NUMBER(b));

JS_EQ_VARIANT(NUMBER_NUMBER, a.tag == JS_NUMBER_TAG && b.tag == JS_NUMBER_TAG, a.number == b.number, JSValue_NUMBER(a) == JSValue_NUMBER(b));

JS_OR_VARIANT(BOOL_BOOL, a.tag == JS_BOOL_TAG && b.tag == JS_BOOL_TAG, a.boolean || b.boolean, JSValue_BOOL(a) || JSValue_BOOL(b));

JS_ADD_VARIANT(DOUBLE_DOUBLE, a.tag == JS_NUMBER_TAG && b.tag == JS_NUMBER_TAG, JS_NUMBER(a.number + b.number), JS_ADD_DOUBLE_STRING(a, b));
JS_ADD_VARIANT(DOUBLE_STRING, a.tag == JS_NUMBER_TAG && b.tag == JS_STRING_TAG, JS_STRING(HPRINTF("%f%s", a.number, b.string)), JS_ADD_STRING_STRING(a, b));
JS_ADD_VARIANT(STRING_STRING, a.tag == JS_STRING_TAG && b.tag == JS_STRING_TAG, JS_STRING(HPRINTF("%s%s", a.string, b.string)), JS_STRING(HPRINTF("%s%s", JSValue_STR(a), JSValue_STR(b))));

JS_SUB_VARIANT(DOUBLE_DOUBLE, a.tag == JS_NUMBER_TAG && b.tag == JS_NUMBER_TAG, JS_NUMBER(a.number - b.number), JS_NUMBER(JSValue_NUMBER(a) - JSValue_NUMBER(b)));

JS_MUL_VARIANT(DOUBLE_DOUBLE, a.tag == JS_NUMBER_TAG && b.tag == JS_NUMBER_TAG, JS_NUMBER(a.number * b.number), JS_NUMBER(JSValue_NUMBER(a) * JSValue_NUMBER(b)));

JS_DIV_VARIANT(DOUBLE_DOUBLE, a.tag == JS_NUMBER_TAG && b.tag == JS_NUMBER_TAG, JS_NUMBER(a.number / b.number), JS_NUMBER(JSValue_NUMBER(a) / JSValue_NUMBER(b)));

JS_MOD_VARIANT(DOUBLE_DOUBLE, a.tag == JS_NUMBER_TAG && b.tag == JS_NUMBER_TAG, JS_NUMBER(fmod(a.number, b.number)), JS_NUMBER(fmod(JSValue_NUMBER(a), JSValue_NUMBER(b))));

/** 
 * Globals
 */

JS_DEFN(console_log) {
	VARGS(VARG(str));
	printf("%s\n", JSValue_STR(str));
	return JS_NULL;
}

JSValue console;
JSValue _object_prototype;

void initialze_globals() {
	// Object prototypes.
	_object_prototype = ((JSValue) {JS_OBJECT_TAG, {.object = hashmap_new()}});

	// Setup console.
	console = JS_OBJECT();
	JS_SET_PROP(console, "log", console_log);
}

void destroy_globals() {
	JS_OBJECT_FREE(console);
}

JSValue module_0;

// TODO (Separate js_main function): This should be in its own file.
int js_main () {
	initialze_globals();
	JS_CALL_FUNC(module_0);
	destroy_globals();
	return 0;
}
