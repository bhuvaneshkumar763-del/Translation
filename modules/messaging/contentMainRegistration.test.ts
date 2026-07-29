import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_MAIN_REGISTRATION_ID, syncContentMainRegistration } from './contentMainRegistration';

function makeScriptingMock(initiallyRegistered: boolean) {
  let registered = initiallyRegistered;
  return {
    getRegisteredContentScripts: vi.fn(async () => (registered ? [{ id: CONTENT_MAIN_REGISTRATION_ID }] : [])),
    registerContentScripts: vi.fn(async () => {
      registered = true;
    }),
    unregisterContentScripts: vi.fn(async () => {
      registered = false;
    }),
  };
}

describe('syncContentMainRegistration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers content-main when the permission is granted but it is not yet registered', async () => {
    const scripting = makeScriptingMock(false);
    vi.stubGlobal('browser', {
      permissions: { contains: vi.fn(async () => true) },
      scripting,
    });

    await syncContentMainRegistration();

    expect(scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: CONTENT_MAIN_REGISTRATION_ID,
        matches: ['<all_urls>'],
        js: ['/content-scripts/content-main.js'],
      }),
    ]);
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  it('unregisters content-main when the permission is not granted but it is currently registered', async () => {
    const scripting = makeScriptingMock(true);
    vi.stubGlobal('browser', {
      permissions: { contains: vi.fn(async () => false) },
      scripting,
    });

    await syncContentMainRegistration();

    expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: [CONTENT_MAIN_REGISTRATION_ID] });
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it('does nothing when already in the correct state (granted + registered)', async () => {
    const scripting = makeScriptingMock(true);
    vi.stubGlobal('browser', {
      permissions: { contains: vi.fn(async () => true) },
      scripting,
    });

    await syncContentMainRegistration();

    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  it('does nothing when already in the correct state (not granted + not registered)', async () => {
    const scripting = makeScriptingMock(false);
    vi.stubGlobal('browser', {
      permissions: { contains: vi.fn(async () => false) },
      scripting,
    });

    await syncContentMainRegistration();

    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });
});
