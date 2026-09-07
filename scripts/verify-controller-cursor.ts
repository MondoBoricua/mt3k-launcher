import assert from 'node:assert/strict'
import {
  installPointerCursorRestoration,
  ORBIT_CONTROLLER_MODE_ATTRIBUTE,
  setControllerCursorMode
} from '../src/renderer/src/lib/controllerCursorMode.ts'

class FakeRoot {
  private readonly attributes = new Map<string, string>()

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
}

const root = new FakeRoot()
const events = new EventTarget()

setControllerCursorMode(root, true)
assert.equal(
  root.getAttribute(ORBIT_CONTROLLER_MODE_ATTRIBUTE),
  'true',
  'controller activity must enable cursor hiding'
)

const removePointerCursorRestoration = installPointerCursorRestoration(root, events)
events.dispatchEvent(new Event('mousemove'))
assert.equal(
  root.getAttribute(ORBIT_CONTROLLER_MODE_ATTRIBUTE),
  null,
  'mouse movement must restore the cursor'
)

setControllerCursorMode(root, true)
events.dispatchEvent(new Event('pointerdown'))
assert.equal(
  root.getAttribute(ORBIT_CONTROLLER_MODE_ATTRIBUTE),
  null,
  'a pointer press must restore the cursor without prior movement'
)

removePointerCursorRestoration()
setControllerCursorMode(root, true)
events.dispatchEvent(new Event('mousemove'))
assert.equal(
  root.getAttribute(ORBIT_CONTROLLER_MODE_ATTRIBUTE),
  'true',
  'cleanup must detach pointer listeners'
)

setControllerCursorMode(root, false)
assert.equal(
  root.getAttribute(ORBIT_CONTROLLER_MODE_ATTRIBUTE),
  null,
  'cleanup must be able to clear controller cursor state'
)

console.log('Controller cursor mode and pointer restoration checks passed.')
