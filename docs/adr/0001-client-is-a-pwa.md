# The client is a PWA

Recording happens on a phone in the gym, offline, for a handful of users. We build an installable PWA rather than a native or cross-platform app: one codebase, no app-store publishing, and no Apple developer account needed to get it onto friends' iPhones. The accepted cost: Safari has no Background Sync API, so on iOS records sync only while the app is open. "Background sync" in the vision therefore means "sync without a save button", not sync while the app is closed.
