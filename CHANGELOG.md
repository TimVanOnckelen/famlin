# Changelog

## [0.9.2](https://github.com/TimVanOnckelen/famlin/compare/v0.9.1...v0.9.2) (2026-11-13)


### Features

* **admin:** Backups page with restore onto a running server ([4190968](https://github.com/TimVanOnckelen/famlin/commit/41909683ec7f7ca5c4bfda519dc5a0ae5b5def7b))
* **backup:** one Famlin backup format with restore from the setup screen ([9affbf4](https://github.com/TimVanOnckelen/famlin/commit/9affbf4af5e85bb506190ff5c63f4081a933b386))
* **mobile:** add hidden feed scroll diagnostics for test builds ([7ebd332](https://github.com/TimVanOnckelen/famlin/commit/7ebd3328be39fbbe110a4f43e5e84796cf2b3c65))
* **mobile:** local development app variant that installs next to the store app ([025c41d](https://github.com/TimVanOnckelen/famlin/commit/025c41de80dce333279c8d39b12d058899fa7d08)), closes [#352](https://github.com/TimVanOnckelen/famlin/issues/352)
* send feed scroll diagnostics to the server admin from every build ([d395026](https://github.com/TimVanOnckelen/famlin/commit/d3950266809c7beea0ca64985b4143328d492ae1))
* **web:** self-host Nunito and make the web app installable ([05076be](https://github.com/TimVanOnckelen/famlin/commit/05076be7e779c04a44547dbdcfdf5d3574901163))
* **web:** self-host Nunito and make the web app installable ([ad92d4d](https://github.com/TimVanOnckelen/famlin/commit/ad92d4d1ec0413026ccc86f97336e9a44ad0fda1)), closes [#132](https://github.com/TimVanOnckelen/famlin/issues/132)


### Bug Fixes

* **backend:** bound the email notification fan-out ([7570ced](https://github.com/TimVanOnckelen/famlin/commit/7570ced71301e4dd02a703353033b44bd8727abb))
* **backend:** bound the email notification fan-out ([9c43adf](https://github.com/TimVanOnckelen/famlin/commit/9c43adf52afd49cad59b8f8c61bc745fa1292af4)), closes [#134](https://github.com/TimVanOnckelen/famlin/issues/134)
* build libvips from source so sharp can move to 0.35.5 ([07e120b](https://github.com/TimVanOnckelen/famlin/commit/07e120b7e71c4baa3aca95a768f6ff9f49aafef4))
* make secret settings write-only and API tokens non-admin by default ([b67d155](https://github.com/TimVanOnckelen/famlin/commit/b67d155bd091573dfd08f51f22410942b97c2da0))
* make secret settings write-only and API tokens non-admin by default ([f76fb66](https://github.com/TimVanOnckelen/famlin/commit/f76fb6691b5307e9ffe7aba152041be784e433d5))
* **mobile:** align Expo packages with the SDK's expected versions ([9542b40](https://github.com/TimVanOnckelen/famlin/commit/9542b4052f549b8f72db352656c4436118e4b84c))
* **mobile:** align Expo packages with the SDK's expected versions ([c77322a](https://github.com/TimVanOnckelen/famlin/commit/c77322a0d855867ca9619c3b1ebdf15e3d694f67))
* **mobile:** align Expo packages with the SDK's expected versions ([20917cd](https://github.com/TimVanOnckelen/famlin/commit/20917cd29a160399fc7d2676735b563f9cceedf3))
* **web:** add border to incoming chat bubbles ([b2902f2](https://github.com/TimVanOnckelen/famlin/commit/b2902f2cb18622238a3a12e444a596f7be16d490))
* **web:** Photos tab 'All families' chip showed only the first family ([200ed5a](https://github.com/TimVanOnckelen/famlin/commit/200ed5ac794e2ee816444ce57dafc65ce987c7e7))
* **web:** Photos tab 'All families' chip showed only the first family ([79e4d65](https://github.com/TimVanOnckelen/famlin/commit/79e4d65d2476dec3118e24c22b00ffa90dd6aa1b))

## [0.9.1](https://github.com/TimVanOnckelen/famlin/compare/v0.9.0...v0.9.1) (2026-11-10)


### Features

* **backup:** restore a scheduled-backup dump from the setup screen ([5142c44](https://github.com/TimVanOnckelen/famlin/commit/5142c4489478b9b9597e0d8bb620a955648d073e))
* **ci:** auto-deploy the Cloud Run demo after each dev image build ([84b7ed9](https://github.com/TimVanOnckelen/famlin/commit/84b7ed90c6951eefcbaf07d5e81b09c1e1264eb4))
* explain the read-only demo on login screens and blocked actions ([1e8103b](https://github.com/TimVanOnckelen/famlin/commit/1e8103b5ce9a8087eb5797f2950f72f14e83f6a3))
* gift-list wishlists for people without an account ([71d0908](https://github.com/TimVanOnckelen/famlin/commit/71d0908c79b96d51b1530c898f662dce2625b11d))
* make the read-only demo explain itself (login notices, blocked actions, English sample data) ([c4baada](https://github.com/TimVanOnckelen/famlin/commit/c4baada117353158d39beb3a25b53c7eef480dd6))
* richer demo data with photos, and auto-deploy the Cloud Run demo ([00b95b0](https://github.com/TimVanOnckelen/famlin/commit/00b95b0fffca6a56acdbb9462408c83fa53bed71))
* seed the demo with content for every feature, including photos ([b47ed43](https://github.com/TimVanOnckelen/famlin/commit/b47ed435f318e426f73d2cd2551cc081eec35c67))
* seed the demo with English sample content ([cedbe6d](https://github.com/TimVanOnckelen/famlin/commit/cedbe6d777bc0d5484bd20c26ccfa2dd14101929))
* **web:** create and RSVP to event posts ([9ec9287](https://github.com/TimVanOnckelen/famlin/commit/9ec9287a46061c550540a7209c76223b327ce4ab))
* **web:** create and RSVP to event posts ([41d28a9](https://github.com/TimVanOnckelen/famlin/commit/41d28a9282aa7df2bfc724351766d966d3aaf41e))


### Bug Fixes

* **backup:** restore dumps only from the server's backups volume ([fe2934b](https://github.com/TimVanOnckelen/famlin/commit/fe2934b0aeb9133c3c758539b3f2e27b99fd03eb))
* **deps:** align workspace TanStack Query versions with mobile ([fad6a44](https://github.com/TimVanOnckelen/famlin/commit/fad6a449a79d4b17fbe1bb793a6f7999ac7ccaf2))
* **export:** don't crash on missing media and close streams on any disconnect ([96336e6](https://github.com/TimVanOnckelen/famlin/commit/96336e63cd86fc3a9ec79f88cd763b9dcc989f70))
* **export:** stream the data export as a native browser download ([d2492dc](https://github.com/TimVanOnckelen/famlin/commit/d2492dc3dadd9e58a6ab72a9a57c508ae387cedb))
* **i18n:** add the French event strings missing from the backend and admin ([985b8ce](https://github.com/TimVanOnckelen/famlin/commit/985b8ce50768b0e326c9619f1426ea3b07be6420))
* **i18n:** use Tim's Dutch wording for the event type description ([84228a5](https://github.com/TimVanOnckelen/famlin/commit/84228a57054e846e867c07f8e5c5cc3d49b8094f))
* updated architecure docs to be less clumsy and over detailed ([9750cc8](https://github.com/TimVanOnckelen/famlin/commit/9750cc89f5b52a08cece33fd46a53922da4db175))
* warnings and tips now render correctly ([40325b0](https://github.com/TimVanOnckelen/famlin/commit/40325b004d3fc0b5336bca91352a914519bcb7ac))

## [0.9.0](https://github.com/TimVanOnckelen/famlin/compare/v0.8.7...v0.9.0) (2026-11-08)


### Features

* add a Caddy overlay with automatic HTTPS ([#339](https://github.com/TimVanOnckelen/famlin/issues/339)) ([9b8789b](https://github.com/TimVanOnckelen/famlin/commit/9b8789b8fb79ddab8c7d2bf22dedf77b625ad82c))
* add a Cloudflare Tunnel overlay and guide ([#340](https://github.com/TimVanOnckelen/famlin/issues/340)) ([4bae242](https://github.com/TimVanOnckelen/famlin/commit/4bae2420352a8a881ce36a301c7ae442699a1fdb))
* add a one-line VPS installer ([#341](https://github.com/TimVanOnckelen/famlin/issues/341)) ([ab67b15](https://github.com/TimVanOnckelen/famlin/commit/ab67b15b22a8c47b33b9d77c16089caf274cc1a6))
* add minimal mobile device diagnostics ([158bdd0](https://github.com/TimVanOnckelen/famlin/commit/158bdd0fa54b4c2705f4e9f7ef9a814ab9b3dc71))
* **admin:** first-run setup wizard and getting-started checklist ([#344](https://github.com/TimVanOnckelen/famlin/issues/344)) ([cd64c14](https://github.com/TimVanOnckelen/famlin/commit/cd64c147bf1fabc7fb1e8beabb45206cac047b1e))
* **admin:** show an "update available" notice ([#347](https://github.com/TimVanOnckelen/famlin/issues/347)) ([4aee461](https://github.com/TimVanOnckelen/famlin/commit/4aee461f378d4c2605c63643926772b3bc393b9c))
* advertise server features in server-info and add serverSupports() ([762bea0](https://github.com/TimVanOnckelen/famlin/commit/762bea0f690c6529e46e9bc162cf6489b39f9254))
* **backend:** Implementing backend portion of event RSVPs; web and mobile screens incoming ([bd78b63](https://github.com/TimVanOnckelen/famlin/commit/bd78b6380a124f96d4cf5a58c8283b7a53e4700a))
* **backend:** show each family all of its own members' event RSVPs ([192a6cf](https://github.com/TimVanOnckelen/famlin/commit/192a6cf8d5f78a2fb5975ced91c35ed4e0126af3))
* **devices:** report mobile diagnostics ([c3a4a3b](https://github.com/TimVanOnckelen/famlin/commit/c3a4a3be409cb22c22062f5c9a83f6f95c6cded4)), closes [#336](https://github.com/TimVanOnckelen/famlin/issues/336)
* easy self-hosting for non-technical users ([1e059b4](https://github.com/TimVanOnckelen/famlin/commit/1e059b4628a9ef195b67c6d1890d3e4168b2c8a4))
* enable scheduled backups by default on new installs ([#346](https://github.com/TimVanOnckelen/famlin/issues/346)) ([5da4043](https://github.com/TimVanOnckelen/famlin/commit/5da4043f3c6ebf1bb2cb0138ac81b264ada53fe7))
* Family Wiki backend and web app ([#118](https://github.com/TimVanOnckelen/famlin/issues/118)) ([9947085](https://github.com/TimVanOnckelen/famlin/commit/9947085bf2403a3ec260f154d502d5c2961b98e0))
* Family Wiki on web and mobile ([#118](https://github.com/TimVanOnckelen/famlin/issues/118)) ([356813e](https://github.com/TimVanOnckelen/famlin/commit/356813e4dbcf7077d3d1707ba0acd273563304c3))
* **i18n:** add French language support ([873a941](https://github.com/TimVanOnckelen/famlin/commit/873a94130517462a5c3b04bcd6f1a00056718957))
* **i18n:** Adding Portuguese (Portugal) language support, mostly with AI, with human review ([779d4bc](https://github.com/TimVanOnckelen/famlin/commit/779d4bc8bb37fadf0214299759b259de0576f28a))
* link notification emails to the web app via a publicUrl setting ([2022eb4](https://github.com/TimVanOnckelen/famlin/commit/2022eb463fe163802a5fca923eeb0b10121fd570)), closes [#243](https://github.com/TimVanOnckelen/famlin/issues/243)
* **mobile:** Family Wiki screens ([#118](https://github.com/TimVanOnckelen/famlin/issues/118)) ([d64dc19](https://github.com/TimVanOnckelen/famlin/commit/d64dc199948b1daade29d04b3759e5f5764e3ebd))
* **mobile:** hide features the connected server doesn't support ([172de74](https://github.com/TimVanOnckelen/famlin/commit/172de744a59a5f383977c7f621916a77c02bcff2))
* **mobile:** treat features as unknown on servers without a features list ([f81b63b](https://github.com/TimVanOnckelen/famlin/commit/f81b63bf02c3dfecb3d802d98a81d480a6a63b17))
* **mobile:** warn when the server is older than the supported window ([66b0c7a](https://github.com/TimVanOnckelen/famlin/commit/66b0c7a9f68bc7b08f924300394af3472a186ca9))
* QR code to connect the mobile app to a server ([#345](https://github.com/TimVanOnckelen/famlin/issues/345)) ([fdfb8e1](https://github.com/TimVanOnckelen/famlin/commit/fdfb8e12fe46674cd1fa78d5ab808f6899a970ec))
* stage a Home Assistant add-on ([#343](https://github.com/TimVanOnckelen/famlin/issues/343)) ([8e6d6c1](https://github.com/TimVanOnckelen/famlin/commit/8e6d6c1d12e8fc882096c5c0c4d672c4f0ced170))
* stage Umbrel and CasaOS app store manifests ([#342](https://github.com/TimVanOnckelen/famlin/issues/342)) ([7159518](https://github.com/TimVanOnckelen/famlin/commit/7159518a4d77a62be12f9bf0de5a9301137a0dd5))
* start without a .env by generating JWT and database secrets ([#338](https://github.com/TimVanOnckelen/famlin/issues/338)) ([f668aff](https://github.com/TimVanOnckelen/famlin/commit/f668affeb66e4572ef1187774451490833744efe))
* **web:** add profile details editing and avatar cropping ([51b3244](https://github.com/TimVanOnckelen/famlin/commit/51b3244fe7e7891990001cfc2974f5afa480874e))
* **web:** avatar-menu Members entry and "/" search shortcut ([9fa2516](https://github.com/TimVanOnckelen/famlin/commit/9fa251680c757f35416b39490e164ef1acafba1b)), closes [#242](https://github.com/TimVanOnckelen/famlin/issues/242)
* **web:** Dutch and Chinese strings for the Family Wiki ([#118](https://github.com/TimVanOnckelen/famlin/issues/118)) ([41f9527](https://github.com/TimVanOnckelen/famlin/commit/41f9527392068adfe66460a543bfdb41e2f1deb6))
* **web:** link a post from the wiki editor ([#118](https://github.com/TimVanOnckelen/famlin/issues/118)) ([dd6e280](https://github.com/TimVanOnckelen/famlin/commit/dd6e280d68ae612d20f2bdd31aaf1411c8b83c38))


### Bug Fixes

* address review findings for the setup wizard, HA add-on and installer ([c28246b](https://github.com/TimVanOnckelen/famlin/commit/c28246b106a97b67f71986f0e24d84ef88be1541))
* address review findings for zero-config and QR connect ([6b1b3a9](https://github.com/TimVanOnckelen/famlin/commit/6b1b3a96021b7063a302ef71f6248ded9ddf54b4))
* **admin:** correct docs link for off-site backups ([0afa6f3](https://github.com/TimVanOnckelen/famlin/commit/0afa6f3079c9f9828c9f1d5099dae5ebf3219482))
* **api-client:** treat a missing upload-status endpoint as ready ([a31a848](https://github.com/TimVanOnckelen/famlin/commit/a31a8487fb7bd9a8ba3118903c891179f285858a)), closes [#377](https://github.com/TimVanOnckelen/famlin/issues/377) [#379](https://github.com/TimVanOnckelen/famlin/issues/379)
* **auth:** bind Sign in with Apple tokens to the server via the nonce ([31bba75](https://github.com/TimVanOnckelen/famlin/commit/31bba752ea6a5f01bbec0ccd07673ea5ec85d822))
* **auth:** check the Apple nonce host against publicUrl or the raw Host header ([74ff4c6](https://github.com/TimVanOnckelen/famlin/commit/74ff4c6a32ff4650e523f48e0286b972d36b7196))
* **backend:** apply canReadUpload to member export files ([cecdcec](https://github.com/TimVanOnckelen/famlin/commit/cecdceca4b00fa736b582aca73aa2fab65f2eecf))
* **backend:** clear an event RSVP from any copy of a cross-posted event ([065f4ad](https://github.com/TimVanOnckelen/famlin/commit/065f4ad53cc06601d64a49b9c513a3dbe22bcbf0))
* bound on-demand thumbnail backfill and retry transient failures ([e494a4b](https://github.com/TimVanOnckelen/famlin/commit/e494a4bac4e3aae06f5b9c520fc984576859cf22))
* **ci:** pin compat-job actions and gate the wiki on a server feature ([1914125](https://github.com/TimVanOnckelen/famlin/commit/1914125fa871cc0ae92322ca5f448e1494b36fb5))
* **docs:** link to doc files instead of relative URLs ([cf6f360](https://github.com/TimVanOnckelen/famlin/commit/cf6f360c53628ad79a27fd532a521dbe3e7ac58c))
* **docs:** link to doc files instead of relative URLs ([b398201](https://github.com/TimVanOnckelen/famlin/commit/b398201c8150d22cebb7bfddd26e4eb3eda7bc58))
* **docs:** respect /docs image base ([c84d801](https://github.com/TimVanOnckelen/famlin/commit/c84d80118a2ebd9be45d6009d22fc0231def10d6))
* **docs:** use the docs base path for images ([e784701](https://github.com/TimVanOnckelen/famlin/commit/e7847012a7fe58c42ef4c01fc8d20df3bd4b91a1))
* keep wiki Markdown parsing linear and merge category case ([#118](https://github.com/TimVanOnckelen/famlin/issues/118)) ([dca9da4](https://github.com/TimVanOnckelen/famlin/commit/dca9da4785c193646861f378e915a57bb613b63f))
* linked-album thumbnails 404 and missing upload thumbnails ([#386](https://github.com/TimVanOnckelen/famlin/issues/386)) ([bbb42dd](https://github.com/TimVanOnckelen/famlin/commit/bbb42dd668330c78afbebdfd899aa34ad0ce1dfa))
* linked-album thumbnails 404 and missing upload thumbnails ([#386](https://github.com/TimVanOnckelen/famlin/issues/386)) ([063fe6e](https://github.com/TimVanOnckelen/famlin/commit/063fe6e5cd1869820cffb009b05a37852fbef82d))
* **mobile:** align Expo SDK 58 patch versions with expo install --check ([f7b0a9e](https://github.com/TimVanOnckelen/famlin/commit/f7b0a9e70c207a2eb675558df7813ddea33c86a5))
* **mobile:** align Expo SDK 58 patch versions with expo install --check ([39a3a5f](https://github.com/TimVanOnckelen/famlin/commit/39a3a5f5e6e11cb2dcecb710e3cd010e10513eb6))
* **mobile:** keep push registration working when device diagnostics fail ([cbbad8b](https://github.com/TimVanOnckelen/famlin/commit/cbbad8b35eaf04493a5cb9ec840efd420254fbb3))
* **mobile:** keep push registration working when device diagnostics fail ([76ac9db](https://github.com/TimVanOnckelen/famlin/commit/76ac9db54ae880a7f9cf9030a5ae1e0d85baae37))
* **mobile:** pin @react-native-community/datetimepicker to Expo's 9.2.1 ([05410c5](https://github.com/TimVanOnckelen/famlin/commit/05410c53bd034a8b0339f34fbc48f672d1065f7d))
* **mobile:** stop repeating requests for features an older server lacks ([c647a73](https://github.com/TimVanOnckelen/famlin/commit/c647a731ab6250f01cb87586890b7419fdfb1342))
* serve thumbnails for older posts and pre-fix clients ([#386](https://github.com/TimVanOnckelen/famlin/issues/386)) ([5e28290](https://github.com/TimVanOnckelen/famlin/commit/5e2829020ff9aa356b129a23235e72cc5960ecf1))
* stop upgrading asset requests to https so plain-HTTP access works ([db2bf1c](https://github.com/TimVanOnckelen/famlin/commit/db2bf1ce1fa78f93e27bc0c70b12b8ce7b9d262a))
* **web:** keep the wiki editor's icon and title side by side ([#118](https://github.com/TimVanOnckelen/famlin/issues/118)) ([28a7fba](https://github.com/TimVanOnckelen/famlin/commit/28a7fba934670dc5a6bcb22c70d452f2a94ade3c))
* **web:** use the upload itself when an old server has no status endpoint ([b79e6da](https://github.com/TimVanOnckelen/famlin/commit/b79e6da3c676e8cbd2d91253b759c51c7ca5240b)), closes [#377](https://github.com/TimVanOnckelen/famlin/issues/377)
* wiki review fixes on mobile and web ([#118](https://github.com/TimVanOnckelen/famlin/issues/118)) ([b7033bb](https://github.com/TimVanOnckelen/famlin/commit/b7033bb6a28559954dc9e31a418540084f5ed57c))


### Miscellaneous Chores

* release 0.9.0 ([9dfa8fd](https://github.com/TimVanOnckelen/famlin/commit/9dfa8fda089dc83e847af0430eeebaa5e4b3328d))

## [0.8.7](https://github.com/TimVanOnckelen/famlin/compare/v0.8.6...v0.8.7) (2026-11-03)


### Features

* add background media processing, live photos and web post drafts ([287f159](https://github.com/TimVanOnckelen/famlin/commit/287f159cd7be0acf80342491ff27a58eacf96318))
* **admin:** unify modals and improve user and group management ([c975ba7](https://github.com/TimVanOnckelen/famlin/commit/c975ba7c68f6dc475ef61d2d0f26ee6a7ba2f10f))
* **backend:** refuse to start an older image against a newer database ([ccfd9dd](https://github.com/TimVanOnckelen/famlin/commit/ccfd9dd5a9e09a66018396f97288da1a5c254b72))
* **web:** accept family invitations in the browser ([ac42b63](https://github.com/TimVanOnckelen/famlin/commit/ac42b635fddb254adf9705f461e8269bdcc40041))
* **web:** add a custom post type picker and reuse the shared switch ([aebfd49](https://github.com/TimVanOnckelen/famlin/commit/aebfd49535aab127b552b03816e46743a5e18488))
* **web:** add a custom post type picker and reuse the shared switch ([d54bb1e](https://github.com/TimVanOnckelen/famlin/commit/d54bb1ea2d884abeea88263bb795c601f1642aa5))
* **web:** add a custom post type picker and reuse the shared switch ([67989d7](https://github.com/TimVanOnckelen/famlin/commit/67989d73f25b9a7922949f0a244ae0b71218b060))
* **web:** add a persistent family and member sidebar to the feed ([95111ba](https://github.com/TimVanOnckelen/famlin/commit/95111ba2f915a2ecef6fbcfa84e69076f1111f37))
* **web:** support trip creation and check-ins ([0d9ad51](https://github.com/TimVanOnckelen/famlin/commit/0d9ad51a569b37ce0358af9972ed1ffbce781048))
* **web:** support trip creation and check-ins ([b98c326](https://github.com/TimVanOnckelen/famlin/commit/b98c326df3c6c4178ddc94a27d490a810b178f7a))


### Bug Fixes

* **admin:** redirect /admin to /admin/ ([3a1ed32](https://github.com/TimVanOnckelen/famlin/commit/3a1ed3270e4659b0758e17700bbe63cd29450740))
* **admin:** redirect /admin to /admin/ ([9b9cc09](https://github.com/TimVanOnckelen/famlin/commit/9b9cc0941c8024cacc59e45ea9a138055fa09927))
* **admin:** reject non-admin sessions at login ([034a65d](https://github.com/TimVanOnckelen/famlin/commit/034a65d33d08bff38065cfc1d70276ad21e0446f))
* **backend:** use fallback when primary storage is unavailable at sta… ([774de44](https://github.com/TimVanOnckelen/famlin/commit/774de44e6e26e386e24d4c1f717aa06c2a5146cc))
* **backend:** use fallback when primary storage is unavailable at startup ([a99f78c](https://github.com/TimVanOnckelen/famlin/commit/a99f78cf328ce898593c699741ba17fa0d167be9))
* exempt media reads from the shared rate limit ([7b856db](https://github.com/TimVanOnckelen/famlin/commit/7b856dbc080181297993055995ebc33b203b05d6))
* exempt media reads from the shared rate limit ([1d7b6c9](https://github.com/TimVanOnckelen/famlin/commit/1d7b6c930d37b43bacf6e199ff4b47a74263ef24))
* **mobile:** clarify camera permission purpose for story photos ([f7bbbc8](https://github.com/TimVanOnckelen/famlin/commit/f7bbbc82ffaa19e55d8f91274924a106696cf0ee))
* **mobile:** enable camera permission for story photos ([81c4d35](https://github.com/TimVanOnckelen/famlin/commit/81c4d3583784b4d3cba1128207cc1e556d39330f))
* **mobile:** unify swipe-to-dismiss for stories and media viewer ([73c7625](https://github.com/TimVanOnckelen/famlin/commit/73c76254354f67d17106e038866c67c827d4f81a))
* **mobile:** use native date pickers for trip dates ([ba84fec](https://github.com/TimVanOnckelen/famlin/commit/ba84fec52b1c35d6100ed2b68583f624111474e2))
* **web:** fall back to the default Famlin favicon ([7b5e1ff](https://github.com/TimVanOnckelen/famlin/commit/7b5e1ff41f2afcf9724bdb613730a24e95b51d82))
* **web:** fall back to the default Famlin favicon ([c05fa0f](https://github.com/TimVanOnckelen/famlin/commit/c05fa0f8306d5802b28ab2602e5de49df2f6ac73))

## [0.8.6](https://github.com/TimVanOnckelen/famlin/compare/v0.8.5...v0.8.6) (2026-11-01)


### Bug Fixes

* **backend:** serve admin index.html without reply.sendFile ([4720bf3](https://github.com/TimVanOnckelen/famlin/commit/4720bf356a1d933bcf45157f59f63598fb45b5cd))
* **backend:** serve admin index.html without reply.sendFile ([b9310af](https://github.com/TimVanOnckelen/famlin/commit/b9310af4cd344e2f6a8162383e9467f79eb23d6b))

## [0.8.5](https://github.com/TimVanOnckelen/famlin/compare/v0.8.4...v0.8.5) (2026-11-01)


### Features

* **backend:** add S3-compatible media storage and bidirectional migration ([bc81251](https://github.com/TimVanOnckelen/famlin/commit/bc81251c8656e61a9ed7509d4d1438d4c01e10f2))
* gift lists with optional Secret Santa draw ([6986e9d](https://github.com/TimVanOnckelen/famlin/commit/6986e9d9fe8ca0cdd1620c84f79c3702aea5f04e))
* gift lists with optional Secret Santa draw ([#307](https://github.com/TimVanOnckelen/famlin/issues/307)) ([c14a8ef](https://github.com/TimVanOnckelen/famlin/commit/c14a8efef2564ca84d55d1e86bafb913dff843eb))
* **web:** add family members and circles overview ([d02a725](https://github.com/TimVanOnckelen/famlin/commit/d02a725e52731a1d8da90bb57ad60554a5bd5e60))


### Bug Fixes

* address gift list client review and lean check ([#307](https://github.com/TimVanOnckelen/famlin/issues/307)) ([c053603](https://github.com/TimVanOnckelen/famlin/commit/c053603fcdc82ad15d37969360bc8f30ef761a2e))
* **gift-lists:** serialize wish adds, clean up wish photos, reuse delete hook ([#307](https://github.com/TimVanOnckelen/famlin/issues/307)) ([5f4bb8c](https://github.com/TimVanOnckelen/famlin/commit/5f4bb8cfd250a112885ef005f65abd5ccf2846b3))
* **mobile:** resolve two new gift list lint warnings ([#307](https://github.com/TimVanOnckelen/famlin/issues/307)) ([e4cf4c7](https://github.com/TimVanOnckelen/famlin/commit/e4cf4c72c3683bc6402ce2c8198f13130a0b5514))

## [0.8.4](https://github.com/TimVanOnckelen/famlin/compare/v0.8.3...v0.8.4) (2026-10-28)


### Features

* edit and delete posts from web, and let admins edit any post ([51891d8](https://github.com/TimVanOnckelen/famlin/commit/51891d87337c0d00959f51a989dfee24bc8a632e)), closes [#246](https://github.com/TimVanOnckelen/famlin/issues/246)
* **mobile:** share photos and videos to Famlin from the OS share sheet ([16908b9](https://github.com/TimVanOnckelen/famlin/commit/16908b9a02bb67e667bb1d89305020a192cdb2ba))
* scheduled backups and admin system status panel with email alerts ([c99c160](https://github.com/TimVanOnckelen/famlin/commit/c99c160c1d188c494673fda94d8ff33bd5bc6fbb))


### Bug Fixes

* **posts:** show cross-posted comments merged across visible copies ([fdf76f1](https://github.com/TimVanOnckelen/famlin/commit/fdf76f1d8764ea5c41d2544391d9423278b5865c))
* **posts:** show cross-posted reactions and comments merged across visible copies ([bbc4a34](https://github.com/TimVanOnckelen/famlin/commit/bbc4a34aa73a1696683c40e3b22ccd890b39e74b))
* **posts:** show cross-posted reactions merged across visible copies ([8394c06](https://github.com/TimVanOnckelen/famlin/commit/8394c067bcce23dca06974f9a7b573a7e7756479))

## [0.8.3](https://github.com/TimVanOnckelen/famlin/compare/v0.8.2...v0.8.3) (2026-10-17)


### Features

* **backend:** add StorageBackend abstraction with a local driver ([ca5622a](https://github.com/TimVanOnckelen/famlin/commit/ca5622a18e45626abad51f812c64715edfe1f67a))
* **backend:** add StorageBackend abstraction with a local driver ([9352ac7](https://github.com/TimVanOnckelen/famlin/commit/9352ac77d622b7f3df04fb472afe51c6df4ed989))
* **web:** add notifications page ([9ec5b7c](https://github.com/TimVanOnckelen/famlin/commit/9ec5b7c13d4991207a3b8899468dd92c38a894aa))
* **web:** add notifications page ([f3245fa](https://github.com/TimVanOnckelen/famlin/commit/f3245fa29216d63a7aff5392e97f67f4c7c4fce4))
* **web:** add shareable family-scoped search ([fbce4c9](https://github.com/TimVanOnckelen/famlin/commit/fbce4c906de773bdbc4dabc62e7e0b6e395f6259))


### Bug Fixes

* **mobile:** keep input fields visible above the keyboard ([4cadccb](https://github.com/TimVanOnckelen/famlin/commit/4cadccb57a71cfe4a8ac3c9655d498f8cb6040ef))
* **mobile:** keep input fields visible above the keyboard ([b0577cc](https://github.com/TimVanOnckelen/famlin/commit/b0577ccb2d2dde81d4ff5172d07669c25c930a89))
* **mobile:** keep input fields visible above the keyboard ([53529f1](https://github.com/TimVanOnckelen/famlin/commit/53529f168acffb3526e56a360d88a5dd3cc2ca6a))

## [0.8.2](https://github.com/TimVanOnckelen/famlin/compare/v0.8.1...v0.8.2) (2026-10-11)


### Features

* **backend:** graceful shutdown, DB-aware healthcheck and log rotation ([d062e84](https://github.com/TimVanOnckelen/famlin/commit/d062e844fbc2b9f46332c1d386f0f00288d7ddad)), closes [#225](https://github.com/TimVanOnckelen/famlin/issues/225)
* **web:** add a favorites page with shell entry points ([633db8f](https://github.com/TimVanOnckelen/famlin/commit/633db8fb52bb7ebf9cca6b09030f7c1426888d75))
* **web:** handle the no-family state across shell, feed, and routes ([cbd4ce1](https://github.com/TimVanOnckelen/famlin/commit/cbd4ce181592ab8edd002e781fc8db04d59af77a))
* **web:** handle the no-family state across shell, feed, and routes ([6d0f763](https://github.com/TimVanOnckelen/famlin/commit/6d0f763594236c3985bd5a93107b70cd5c4bc0eb))
* **web:** mobile-style redesign for wide screens with keyboard navigation ([f3a0d26](https://github.com/TimVanOnckelen/famlin/commit/f3a0d26e9763c2e830834ade3cdc9add4a8de9a0))


### Bug Fixes

* **dev:** simplify dependency setup and load seed environment ([0e7b050](https://github.com/TimVanOnckelen/famlin/commit/0e7b05095f572bf870a0e3069e22cbf51355505d))
* **mobile:** draw a filled bookmark for favorited posts ([a539586](https://github.com/TimVanOnckelen/famlin/commit/a53958634daccca5e407e90019ef980d072bd331)), closes [#220](https://github.com/TimVanOnckelen/famlin/issues/220)
* **mobile:** improve lightbox dismissal and swipe momentum ([7e94653](https://github.com/TimVanOnckelen/famlin/commit/7e946536010adf245bc1022ef0dcbf95ed482de3))
* **mobile:** improve lightbox dismissal and swipe momentum ([5e62949](https://github.com/TimVanOnckelen/famlin/commit/5e629499446742aa15af9630b17b93ab30c572c8))
* **mobile:** keep bookmark box stable on toggle and fill pinned stories ([c787b49](https://github.com/TimVanOnckelen/famlin/commit/c787b49c968b7cc13a3570c4921977e14bad8899))
* smooth story progress and center web reaction buttons ([3b46765](https://github.com/TimVanOnckelen/famlin/commit/3b46765b8f79659422061df8c78c224c10efbf1c))
* **web:** clear file input before opening the picker, not in the chan… ([d9cc830](https://github.com/TimVanOnckelen/famlin/commit/d9cc83062af7ed68c53e199c7e2a0e738facec00))
* **web:** clear file input before opening the picker, not in the change handler ([e94b565](https://github.com/TimVanOnckelen/famlin/commit/e94b5658f92bd606508031cfc16dabc5bddfb7fd))
* **web:** don't read or write refs during render (lint) ([8543052](https://github.com/TimVanOnckelen/famlin/commit/854305279608a54ba4822ac63517c721bf9c110c))
* **web:** fetch groups during bootstrap so family-scoped tabs never flash on cold load ([c0da898](https://github.com/TimVanOnckelen/famlin/commit/c0da898072302f0ed51374cb92cd2323d732c35e))
* **web:** hide favorites navigation for users without groups ([9c45171](https://github.com/TimVanOnckelen/famlin/commit/9c451719e2d30e3a0d616f2d232fb1f6279eae19))
* **web:** visual and layout fixes across feed, chat, albums and trips ([43b102e](https://github.com/TimVanOnckelen/famlin/commit/43b102e8cb91f691426676bbdc64c9cf47e7ce1c))
* **web:** visual and layout fixes across feed, chat, albums and trips ([1c8cbea](https://github.com/TimVanOnckelen/famlin/commit/1c8cbeaf3b0b09c98492be15543c3139a6180b20))

## [0.8.1](https://github.com/TimVanOnckelen/famlin/compare/v0.8.0...v0.8.1) (2026-10-06)


### Features

* **branding:** per-family branding backend, API client and admin UI ([57c2be5](https://github.com/TimVanOnckelen/famlin/commit/57c2be51f7bbf11168bb6f38e906eca45fdda4ac))
* **mobile:** apply per-family branding ([c943164](https://github.com/TimVanOnckelen/famlin/commit/c9431644e0b8a0491365361ef5c205cd57890e93))
* **uploads:** scope /uploads/* reads to the media's group(s) ([d8fcaa1](https://github.com/TimVanOnckelen/famlin/commit/d8fcaa1918dd59419e81b97c797e69078b373434)), closes [#184](https://github.com/TimVanOnckelen/famlin/issues/184)
* **web:** apply per-family branding ([ff74d14](https://github.com/TimVanOnckelen/famlin/commit/ff74d14e4bbde694defcb5fa25d3d87d75eb9201))
* **web:** real URLs for every page, plus a /posts/:id permalink ([9018953](https://github.com/TimVanOnckelen/famlin/commit/9018953bfbbbb83a587d0f77b9adad9b58f0d804))


### Bug Fixes

* **api-client:** use node16 module resolution so TS 5 and TS 7 both build it ([426171b](https://github.com/TimVanOnckelen/famlin/commit/426171bf38cbfad1767613f37bf3a1a1ce4d204b))
* **branding:** type the logo upload catch without `any` ([e69146d](https://github.com/TimVanOnckelen/famlin/commit/e69146d9c82c4366819b622d44ea004e660a0526))
* **deps:** resolve Dependabot security alerts ([c5f8e39](https://github.com/TimVanOnckelen/famlin/commit/c5f8e391233a9f919f4013da32d64756c98d1080))
* **docker:** actually compile sharp against the system libvips for HEIC ([c4b8711](https://github.com/TimVanOnckelen/famlin/commit/c4b87114a5e2208671e9547020bc7415f7be474b))
* **docker:** keep libvips-cpp installed for the source-built sharp ([541a4f9](https://github.com/TimVanOnckelen/famlin/commit/541a4f980663dc14dd3e3916d06f948a6dbb99f9))
* **docker:** pin sharp 0.34.5 so the image can decode HEIC ([9b90141](https://github.com/TimVanOnckelen/famlin/commit/9b90141fef4addab8d7923a5ba0a96ac50d9ee65))
* **i18n:** add zh translations for branding strings ([fd9be46](https://github.com/TimVanOnckelen/famlin/commit/fd9be46c35fa3db82737e2d3405f777b0fc005c1))

## [0.8.0](https://github.com/TimVanOnckelen/famlin/compare/v0.7.0...v0.8.0) (2026-10-05)


### ⚠ BREAKING CHANGES

* **security:** SSO logins whose ID token reports email_verified=false are now refused. If your identity provider allows self-registration or editable email addresses, make sure email verification is enabled there so affected family members can still sign in.

### Features

* **admin:** stories moderation tab and per-group stories toggle ([c3dea81](https://github.com/TimVanOnckelen/famlin/commit/c3dea81982dc174b2b9e956acdc0d16978344709)), closes [#157](https://github.com/TimVanOnckelen/famlin/issues/157)
* **api-client:** stories module ([6de3ecd](https://github.com/TimVanOnckelen/famlin/commit/6de3ecd7de921d46cc1314f128e0b9bc6e2e511f)), closes [#157](https://github.com/TimVanOnckelen/famlin/issues/157)
* **backend:** restore an admin data export into an empty instance ([fa6b3e6](https://github.com/TimVanOnckelen/famlin/commit/fa6b3e669227364daf75cd320be1dafc5ed027b3))
* **backend:** stories with 24h expiry, private replies and group Highlights ([3d4df18](https://github.com/TimVanOnckelen/famlin/commit/3d4df188225051bbf76be711a11d862fff5406db)), closes [#157](https://github.com/TimVanOnckelen/famlin/issues/157)
* **i18n:** add Simplified Chinese (zh) translations ([b9bb3ac](https://github.com/TimVanOnckelen/famlin/commit/b9bb3acb77c4dbcee5543e6f33cdd2d178260151))
* **i18n:** language picker on login screens, device-language detection ([624ffab](https://github.com/TimVanOnckelen/famlin/commit/624ffabe471537b4308548c68c50671b878ea057))
* **i18n:** send the UI language as Accept-Language on API requests ([14c95d2](https://github.com/TimVanOnckelen/famlin/commit/14c95d235c4c3479845036290de3e666d28c9b66))
* **mobile:** story tray, composer with overlays, viewer and Highlights ([f5075a8](https://github.com/TimVanOnckelen/famlin/commit/f5075a8d4693e627909da77f7af3cd8a50b5de0e)), closes [#157](https://github.com/TimVanOnckelen/famlin/issues/157)
* self-service data export for members ([31d8926](https://github.com/TimVanOnckelen/famlin/commit/31d892658361fd828f2f30e14b98bdfae465bd71))
* self-service data export for members ([f317a0b](https://github.com/TimVanOnckelen/famlin/commit/f317a0bee3a75b0effb4672f5745b55eae99fc70)), closes [#123](https://github.com/TimVanOnckelen/famlin/issues/123)
* Stories — 24h ephemeral photos with group Highlights ([5921cf6](https://github.com/TimVanOnckelen/famlin/commit/5921cf62e4b25dcc5c66d1bd5e80a7326822acd5))
* **web:** story tray, viewer with reactions and private replies, Highlights ([71d57b1](https://github.com/TimVanOnckelen/famlin/commit/71d57b17029323baf96f0c4d135676814813bbef)), closes [#157](https://github.com/TimVanOnckelen/famlin/issues/157)


### Bug Fixes

* **deps:** bump @fastify/busboy, ip-address and brace-expansion ([fc7d617](https://github.com/TimVanOnckelen/famlin/commit/fc7d617ef9660535315de0011b26deb4d66888c1))
* **mobile:** never send the session token to a server named by an invite link ([cae1ca5](https://github.com/TimVanOnckelen/famlin/commit/cae1ca5b9b5dc65df0bdb92defde9d80def19516))
* **security:** close media-token, OIDC email and upload re-scoping holes ([bf5931f](https://github.com/TimVanOnckelen/famlin/commit/bf5931f7b1c267360e173c5f3a18c69b78470910))
* **web:** widen story bubbles and thicken the unseen ring ([7f87e01](https://github.com/TimVanOnckelen/famlin/commit/7f87e01f6fe2171f317b74863cf68fb91199c2eb)), closes [#157](https://github.com/TimVanOnckelen/famlin/issues/157)

## [0.7.0](https://github.com/TimVanOnckelen/famlin/compare/v0.6.6...v0.7.0) (2026-09-21)


### ⚠ BREAKING CHANGES

* **backend:** The backend now runs on Prisma 7, which executes queries through the @prisma/adapter-pg driver adapter rather than Prisma 5's query engine. No action is required — DATABASE_URL is unchanged and migrations are unchanged — but it is a different database driver path, so upgrade a production instance deliberately rather than incidentally.
* `appStoreUrl` now defaults to the official App Store listing instead of being blank, so deployments that never configured it will start showing an App Store download button on the invite landing page and in `GET /api/auth/server-info`. Admins who distribute their own iOS build should set their own URL, or clear the field in /admin -> Server settings to hide the button.

### Features

* **backend:** migrate to Prisma 7 (supersedes [#99](https://github.com/TimVanOnckelen/famlin/issues/99)) ([7f18341](https://github.com/TimVanOnckelen/famlin/commit/7f1834186174311a45d7c3a17b7b981fff74571c))
* **circles:** add Circle UI to the mobile app ([b43da66](https://github.com/TimVanOnckelen/famlin/commit/b43da6653b1063818f99554943200d1bec25e1e6)), closes [#75](https://github.com/TimVanOnckelen/famlin/issues/75)
* **circles:** add Circle UI to the web app and admin ([1a4340b](https://github.com/TimVanOnckelen/famlin/commit/1a4340b5ab89094e0e18bdaf9a2f0ebed8e6eefa)), closes [#75](https://github.com/TimVanOnckelen/famlin/issues/75)
* **circles:** add Family Circles privacy boundary to the backend ([08eb5df](https://github.com/TimVanOnckelen/famlin/commit/08eb5dff5ad6eafce1dee8388ce055f854897f9a)), closes [#75](https://github.com/TimVanOnckelen/famlin/issues/75)
* **circles:** Family Circles — smaller private audiences inside a family group ([4fcc0b2](https://github.com/TimVanOnckelen/famlin/commit/4fcc0b234626edb193735c088a2eef74a51a3863))
* **circles:** show who is in a circle, and bump expo-build-properties ([dc3afe2](https://github.com/TimVanOnckelen/famlin/commit/dc3afe26e452f7b2b95341b1985deb71bd18d104)), closes [#75](https://github.com/TimVanOnckelen/famlin/issues/75)
* point docs, website and store defaults at the iOS App Store listing ([76a518f](https://github.com/TimVanOnckelen/famlin/commit/76a518f0f27723631f7ca02fb388410a3205a478))


### Bug Fixes

* **backend:** don't require DATABASE_URL to load prisma.config.ts ([8e0f127](https://github.com/TimVanOnckelen/famlin/commit/8e0f127b0480dffe53644a0c3b706595c2ffb623))
* **circles:** close two circle leaks in the admin push subsystem ([37b6359](https://github.com/TimVanOnckelen/famlin/commit/37b6359f643688e05face8eaf9c11ed6ead130ca)), closes [#75](https://github.com/TimVanOnckelen/famlin/issues/75)
* **circles:** remove circle memberships when a member leaves the group ([de2918a](https://github.com/TimVanOnckelen/famlin/commit/de2918a9b8782d9c00d45b479dbd50a856a0ad0c)), closes [#75](https://github.com/TimVanOnckelen/famlin/issues/75)

## [0.6.6](https://github.com/TimVanOnckelen/famlin/compare/v0.6.5...v0.6.6) (2026-09-15)


### Bug Fixes

* **mobile:** bump Expo SDK 57 deps to the versions the SDK expects ([a97e846](https://github.com/TimVanOnckelen/famlin/commit/a97e8466c2c72efe93eb4d378d754db1f9b8adf9))

## [0.6.5](https://github.com/TimVanOnckelen/famlin/compare/v0.6.4...v0.6.5) (2026-09-15)


### Bug Fixes

* allow Sign in with Apple on read-only demo instances ([ee6848e](https://github.com/TimVanOnckelen/famlin/commit/ee6848e4ef6a340b3840b535a220635946922e0e))
* **deps:** patch known vulnerabilities in runtime dependencies ([b3710fc](https://github.com/TimVanOnckelen/famlin/commit/b3710fc0cf7e4082fce55029fac9c09cf3713da0))
* **docker:** unbreak the api-client install in the image build ([746eef6](https://github.com/TimVanOnckelen/famlin/commit/746eef62ce27610fb26947eada02ebc6b7bb871f))
* **mobile:** realign Expo dependencies with the SDK 57 bundled set ([5f17e43](https://github.com/TimVanOnckelen/famlin/commit/5f17e43b144776556f040e1de7e84352d5727827))

## [0.6.4](https://github.com/TimVanOnckelen/famlin/compare/v0.6.3...v0.6.4) (2026-08-14)


### Performance Improvements

* **mobile:** show upload progress on trip check-in and album photo pickers ([10f6a9f](https://github.com/TimVanOnckelen/famlin/commit/10f6a9f75c8a1e1a9aa684ff6c1a83cfaf766789))
* **mobile:** speed up photo/video uploads and show real progress ([f6c0442](https://github.com/TimVanOnckelen/famlin/commit/f6c0442615ec41e87a325b17534f28c231552e26))

## [0.6.3](https://github.com/TimVanOnckelen/famlin/compare/v0.6.2...v0.6.3) (2026-08-11)


### Features

* address App Store review rejection (Sign in with Apple, account deletion, purpose strings, support page) ([c6bd9f4](https://github.com/TimVanOnckelen/famlin/commit/c6bd9f4d06196bc0c8da63b68487c5d6f70c9fb0))
* address App Store review rejection (Sign in with Apple, account… ([52dae9d](https://github.com/TimVanOnckelen/famlin/commit/52dae9d1dc8561af4a35945166a329fb3da8e25a))


### Bug Fixes

* **backend:** optimized upload process for better performance ([fae7ef2](https://github.com/TimVanOnckelen/famlin/commit/fae7ef20ed07c647cf3004e0ed75b9e2a2f9cf27))
* **security:** normalize request paths in auth guards, resolve high advisories ([ab5b088](https://github.com/TimVanOnckelen/famlin/commit/ab5b088222eab5285e033cc311cc56d99bf927c9))
* serve legacy HEIC uploads as JPEG so the web app can render them ([8a676df](https://github.com/TimVanOnckelen/famlin/commit/8a676dfd81bf4ae96ebc58a89d015a44cf82f58e))
* serve legacy HEIC uploads as JPEG so the web app can render them ([d2b9ecd](https://github.com/TimVanOnckelen/famlin/commit/d2b9ecd11bdb8411bac0b74a133e123c5917c729))

## [0.6.2](https://github.com/TimVanOnckelen/famlin/compare/v0.6.1...v0.6.2) (2026-07-25)


### Features

* add Icon component and replace SVGs with icons ([196da6c](https://github.com/TimVanOnckelen/famlin/commit/196da6c80ec2fd86440c5dcd63d3adde469e0014))
* add Icon component and replace SVGs with icons in PhotosPage, ProfilePage, and TripDetailPage ([ef524c9](https://github.com/TimVanOnckelen/famlin/commit/ef524c9e213d3c505310f68c5c913e31b6758b28))
* added shared albums in photos tab ([22d981a](https://github.com/TimVanOnckelen/famlin/commit/22d981a66929a6ff466ecfcddb61a82a9dbb65da))
* albums in photos tab ([d5c66c9](https://github.com/TimVanOnckelen/famlin/commit/d5c66c9f7f1bc821b3ba1bc7a3ac6ca24632ce6a))
* edit post enhanced ([d5c66c9](https://github.com/TimVanOnckelen/famlin/commit/d5c66c9f7f1bc821b3ba1bc7a3ac6ca24632ce6a))
* editing a post now allows editing,removing and adding media. ([22d981a](https://github.com/TimVanOnckelen/famlin/commit/22d981a66929a6ff466ecfcddb61a82a9dbb65da))


### Bug Fixes

* **uploads:** send web uploads as multipart and lift the 15s timeout ([196da6c](https://github.com/TimVanOnckelen/famlin/commit/196da6c80ec2fd86440c5dcd63d3adde469e0014))

## [0.6.1](https://github.com/TimVanOnckelen/famlin/compare/v0.6.0...v0.6.1) (2026-07-25)


### Features

* add collaborative ALBUM post type ([62414f1](https://github.com/TimVanOnckelen/famlin/commit/62414f17d9a13fd64c70e3521e45d408b509af0d))
* add collaborative ALBUM post type ([79dcee6](https://github.com/TimVanOnckelen/famlin/commit/79dcee618e0cc428380e41e8e1995dddd4cff3aa))

## [0.6.0](https://github.com/TimVanOnckelen/famlin/compare/v0.5.1...v0.6.0) (2026-07-20)


### ⚠ BREAKING CHANGES

* Admins must set the `READ_ONLY` environment variable to "true" for demo instances to enable this feature.

### Features

* add read-only mode for demo instances ([ee177d0](https://github.com/TimVanOnckelen/famlin/commit/ee177d09a1fa8e56510af64b38ea01cacc19e7fe))


### Bug Fixes

* add react-native-worklets as a direct mobile dependency ([ac1ee7d](https://github.com/TimVanOnckelen/famlin/commit/ac1ee7d0252dc57a83a6db3e74234d230f170d59))

## [0.5.1](https://github.com/TimVanOnckelen/famlin/compare/v0.5.0...v0.5.1) (2026-07-20)


### Bug Fixes

* update package version to 0.5.0 and add react-native-worklets de… ([0509186](https://github.com/TimVanOnckelen/famlin/commit/0509186d1aaaf4d27e19010f3bc6fe6326637b13))
* update package version to 0.5.0 and add react-native-worklets dependency ([2262de6](https://github.com/TimVanOnckelen/famlin/commit/2262de6b21f61099f7dc623fad15e56727615360))

## [0.5.0](https://github.com/TimVanOnckelen/famlin/compare/v0.4.0...v0.5.0) (2026-07-20)


### ⚠ BREAKING CHANGES

* Admins must ensure they have the necessary permissions to access the new export functionality.
* The API now requires `replyToMessageId` for replies, and the response structure for chat messages has been modified.

### Features

* add bottom navigation for small screens and enhance page navigation ([f39ee2e](https://github.com/TimVanOnckelen/famlin/commit/f39ee2eaa1bc5a897c6db5ec2b9dffc3a8174dcb))
* add data export functionality for admins ([ec1339d](https://github.com/TimVanOnckelen/famlin/commit/ec1339dc9099df25c6b6d389ec36889836a0a46d))
* add reactions modal and API for listing post reactions ([1014a19](https://github.com/TimVanOnckelen/famlin/commit/1014a19221e8999c7f4a117cdb0b07e1568f288d))
* add read-only trip journal view to web app ([459c67f](https://github.com/TimVanOnckelen/famlin/commit/459c67fb1c271c445df7b96c97ec7a87bac78e36))
* add reply functionality to chat messages ([6f9ec56](https://github.com/TimVanOnckelen/famlin/commit/6f9ec56552b68e4b4c9aa60a25f8e46d1ecc5549))
* add reply functionality to chat messages with swipe gesture support ([75a0cd4](https://github.com/TimVanOnckelen/famlin/commit/75a0cd45a8de7e7a0c88da7c159d3c86ab336ca8))
* add trip journal UI to mobile app and shared api-client ([d436ad1](https://github.com/TimVanOnckelen/famlin/commit/d436ad1503450349066560e8f0647cc764e38625))
* add TRIP post type with check-ins, co-travelers and push notifications ([d7d32a3](https://github.com/TimVanOnckelen/famlin/commit/d7d32a38b3b9ac5bb658cae5b744d79caa06f9c6))
* allow cross-posting trips from the mobile composer ([9ac159d](https://github.com/TimVanOnckelen/famlin/commit/9ac159d58307f60a373f38700bb0c25d6d17527e))
* implement multi-photo collage in PostCard component ([207bad0](https://github.com/TimVanOnckelen/famlin/commit/207bad0a306aee908565cfff8d8cde87a78a0805))
* support cross-posting trips to multiple groups ([2e9b952](https://github.com/TimVanOnckelen/famlin/commit/2e9b9529d20e4194d835c75a561e40757c879c31))
* update react-hooks rules to include immutability warnings for Reanimated ([60587ae](https://github.com/TimVanOnckelen/famlin/commit/60587ae343c33a8b659cc1dcf0f2f98137602b5c))


### Bug Fixes

* improve touch handling for image zoom and pan interactions ([78f4fe5](https://github.com/TimVanOnckelen/famlin/commit/78f4fe5db7be94daa2698a520cf3a3933e3ddb3e))

## [0.4.0](https://github.com/TimVanOnckelen/famlin/compare/v0.3.2...v0.4.0) (2026-07-16)


### ⚠ BREAKING CHANGES

* Existing uploads will not have thumbnails generated retroactively; only new uploads will benefit from this feature.

### Features

* add API documentation for chat message operations ([7770774](https://github.com/TimVanOnckelen/famlin/commit/7770774dc8790039bef3184e9054c68872f30b1c))
* add chat functionality with message fetching, sending, and deletion ([cc599d1](https://github.com/TimVanOnckelen/famlin/commit/cc599d1b6d6bf5b74078cece81c904d8c0bc4ca4))
* add expo-build-properties dependency and enable Proguard and resource shrinking for Android ([c611ff0](https://github.com/TimVanOnckelen/famlin/commit/c611ff0f38e8e1ba4f53f06224455e36db974190))
* add image upload variants and thumbnail generation ([2e524be](https://github.com/TimVanOnckelen/famlin/commit/2e524be7269f8a2ae2372698d6fdbbaff672eb2b))
* add video poster generation for uploads and enhance MediaThumbnail component ([9f922b7](https://github.com/TimVanOnckelen/famlin/commit/9f922b7af55a13c87ba1e7cdcf0f285bb9be8c39))
* enhance performance and caching for images and avatars, update auth store usage ([0558a1f](https://github.com/TimVanOnckelen/famlin/commit/0558a1f7d3444b8fe12ab3d5911cf2209598978f))
* optimize MediaPickerModal and PhotosScreen with memoization and callbacks ([ae1cd27](https://github.com/TimVanOnckelen/famlin/commit/ae1cd272621b2debe45a35eec772b298b028370b))


### Bug Fixes

* default to the first family group in chat when multiple options are available ([938a2c4](https://github.com/TimVanOnckelen/famlin/commit/938a2c4a2f67f04df3e49e51a2751b098cdb0331))

## [0.3.2](https://github.com/TimVanOnckelen/famlin/compare/v0.3.1...v0.3.2) (2026-07-15)


### Features

* rate-limit password change/reset and invite preview endpoints ([3ac2003](https://github.com/TimVanOnckelen/famlin/commit/3ac2003d75bc2d0db58399f18990254e2aad98d2))


### Bug Fixes

* dedupe cross-posted posts in search and on-this-day results ([4429968](https://github.com/TimVanOnckelen/famlin/commit/4429968d4e669d5dc96c55f854556384b34a54ff))
* make reaction and poll-vote toggles safe under concurrent requests ([81afd11](https://github.com/TimVanOnckelen/famlin/commit/81afd11edce2e172e9e6361d906e7bece5c0d0b6))
* **mobile:** stop committing the generated iOS native project ([0a279bb](https://github.com/TimVanOnckelen/famlin/commit/0a279bbad0fd41dd929d6ba46416832c50fa5ab4))
* translate remaining hardcoded backend error messages ([dde1a90](https://github.com/TimVanOnckelen/famlin/commit/dde1a908bbc841a8b6db55bfed7d7cde216be197))

## [0.3.1](https://github.com/TimVanOnckelen/famlin/compare/v0.3.0...v0.3.1) (2026-07-15)


### Features

* add version display in layout component and update translations ([998bb0d](https://github.com/TimVanOnckelen/famlin/commit/998bb0d2045b5770ee6a985e38ebdc3e07a14c3a))

## [0.3.0](https://github.com/TimVanOnckelen/famlin/compare/v0.2.2...v0.3.0) (2026-07-15)


### ⚠ BREAKING CHANGES

* Admins must ensure the new PushDeliveryLog table is created in the database by running the latest migration.

### Features

* add push notification log and resend functionality ([d821fa1](https://github.com/TimVanOnckelen/famlin/commit/d821fa1fcddb6f9e44c38da10cf81228dd7d4127))
* add push notification log and resend functionality ([ff3aedc](https://github.com/TimVanOnckelen/famlin/commit/ff3aedccd49374c4630c99ced8a047bed18fbf51))

## [0.2.2](https://github.com/TimVanOnckelen/famlin/compare/v0.2.1...v0.2.2) (2026-07-14)


### Features

* update app version and build number for iOS and Android, adjust EAS configuration ([8e8510c](https://github.com/TimVanOnckelen/famlin/commit/8e8510c26788ebbe60794b6f734c28828c12934d))
* update app version and build number for iOS and Android, adjust… ([4ff73d9](https://github.com/TimVanOnckelen/famlin/commit/4ff73d95602a058961cd4ec2ad148a78e9e6d54c))


### Bug Fixes

* ensure local node_modules for api-client to resolve dependencies ([f71b853](https://github.com/TimVanOnckelen/famlin/commit/f71b85397c32f670235705fb75275009ef3b858e))
* ensure local node_modules for api-client to resolve dependencies ([58ef724](https://github.com/TimVanOnckelen/famlin/commit/58ef7248e1f76eb7f1b6c7379e8b46387f667a65))

## [0.2.1](https://github.com/TimVanOnckelen/famlin/compare/v0.2.0...v0.2.1) (2026-07-14)


### Features

* add poll functionality with voting and results display ([5c142d2](https://github.com/TimVanOnckelen/famlin/commit/5c142d25d780a92324e6a76803d2baeaebcbe0fe))


### Bug Fixes

* handle push notification errors and update app config for FCM support ([ee19139](https://github.com/TimVanOnckelen/famlin/commit/ee191395b1aad575d1e1ccf41bd6eae2a01ba2f2))
* pin EAS project owner in mobile app config ([3ddeb3c](https://github.com/TimVanOnckelen/famlin/commit/3ddeb3c6118d643bfbcd8345f82373e7c1950f7d))

## [0.2.0](https://github.com/TimVanOnckelen/famlin/compare/v0.1.12...v0.2.0) (2026-07-13)


### ⚠ BREAKING CHANGES

* The `createPost` API now requires `groupIds` for cross-posting; ensure your client handles this new parameter.

### Features

* add ExpoMediaLibrary support in Podfile and project configuration ([94e26cd](https://github.com/TimVanOnckelen/famlin/commit/94e26cdaa9fcc8824d933edc29554f0773ab481d))
* add google services configuration for Firebase integration ([0702266](https://github.com/TimVanOnckelen/famlin/commit/07022660b62f0ab858dbcb56dccf8a8253e0c9ba))
* add server info endpoint and version comparison utility ([032f65a](https://github.com/TimVanOnckelen/famlin/commit/032f65a3655582ba517b528e53794d7e9c0ba9ca))
* add update notification banner and version check in the admin dashboard ([7bc1538](https://github.com/TimVanOnckelen/famlin/commit/7bc15382640962c3749582220adf18cad9f33cb0))
* **admin:** unify member onboarding into a shared Add member modal ([4841ca4](https://github.com/TimVanOnckelen/famlin/commit/4841ca4c6fd7692a8530140b743de2e69ec4f7c5))
* **backend:** link timeline album photos to the post that embeds them ([4ba6141](https://github.com/TimVanOnckelen/famlin/commit/4ba6141b21a845ba5f45e68eca869f02a038d435))
* implement cross-posting functionality for posts ([f2dfd43](https://github.com/TimVanOnckelen/famlin/commit/f2dfd43bb957b28cc5845a8368f03d262d4f1be3))
* merge same-label media people across library owners ([3296323](https://github.com/TimVanOnckelen/famlin/commit/32963232d9f98fe07d144814f22b6cd2f29c39d0))
* **mobile:** like, comment, and favorite from the image viewer ([f06f199](https://github.com/TimVanOnckelen/famlin/commit/f06f199242edf27759a6004ed2ef6307d07f9f63))
* **mobile:** pinch-to-zoom and download in the image viewer, actions for posted album photos ([33a20d9](https://github.com/TimVanOnckelen/famlin/commit/33a20d9bd7d7a588007e6e1464b10ced5c09eb95))


### Bug Fixes

* **mobile:** add loading feedback to photos screen and cache thumbnails with expo-image ([8f4e737](https://github.com/TimVanOnckelen/famlin/commit/8f4e7372482bb7c7f985564edb9f93e9bb0d06c1))
* **mobile:** make saving photos from the viewer work on iOS ([82e9cdf](https://github.com/TimVanOnckelen/famlin/commit/82e9cdfe38288466951072ffeb66427156076b4d))
* **mobile:** show a loading spinner for full-size photos in the image viewer ([3b4df8e](https://github.com/TimVanOnckelen/famlin/commit/3b4df8ef84c25a0e854f828a413a3c5ba46e3ff9))


### Performance Improvements

* **backend:** serve stale album cache while refreshing photo timeline in background ([e1e2f22](https://github.com/TimVanOnckelen/famlin/commit/e1e2f226496d06921b64182d5b522beee925869d))

## [0.1.12](https://github.com/TimVanOnckelen/famlin/compare/v0.1.11...v0.1.12) (2026-07-10)


### Features

* add admin panel with user and group management, settings, and localization support ([e33d914](https://github.com/TimVanOnckelen/famlin/commit/e33d9142e53f022428538f06df055670a488f936))
* add API breaking-change check to CI workflow and update contributing guidelines for breaking changes ([1c879d5](https://github.com/TimVanOnckelen/famlin/commit/1c879d55d3cca2e9b3704a1f8cb98b2a8ac18d2a))
* add comment attachment functionality with photo/video support ([ebcd619](https://github.com/TimVanOnckelen/famlin/commit/ebcd61956ae9665496722d41f7dbec3b50b52a3c))
* add end-to-end tests for local-folder media provider ([b5dd878](https://github.com/TimVanOnckelen/famlin/commit/b5dd8783ea48bfbf5cc00ffc6c82df4cf2d45dd3))
* add group labeling to posts in multi-group feeds ([cf42a0d](https://github.com/TimVanOnckelen/famlin/commit/cf42a0d2f154489c55b677f2516cd16a00ddebf0))
* add Immich service integration for album and asset management ([d6ef9f2](https://github.com/TimVanOnckelen/famlin/commit/d6ef9f22031af9b089457ef11732686600133587))
* add Immich service integration for album and asset management ([b3fc2b6](https://github.com/TimVanOnckelen/famlin/commit/b3fc2b6a3fad61bf0491e60e6b98c898aca26620))
* add Notifications, PostDetail, and Profile screens with state management ([f79377e](https://github.com/TimVanOnckelen/famlin/commit/f79377e47f4b19d5d6d91fe3ad7dbddcbee8c74f))
* add personal access tokens (API tokens) functionality ([b34e33c](https://github.com/TimVanOnckelen/famlin/commit/b34e33c28144d003df0a9b1629ce773162f5e8ec))
* add photo and photo timeline schemas, implement PhotosScreen and PhotosPage components ([e82bcd0](https://github.com/TimVanOnckelen/famlin/commit/e82bcd016cc2e5d53d10e9301420c7f6ccd9c145))
* add profile page with avatar upload and notification preferences ([aacc40a](https://github.com/TimVanOnckelen/famlin/commit/aacc40a45245004035c5ffa2551b25f49f95ac33))
* add reaction system to posts and comments ([5055b27](https://github.com/TimVanOnckelen/famlin/commit/5055b27826a74631776efd91c0148decf0b75bfa))
* add ShimmerImage component for improved loading experience and update image rendering across components ([e89c207](https://github.com/TimVanOnckelen/famlin/commit/e89c20710f68bbe51888f5c798d6b8fd568c6983))
* add testing framework and implement tests for various modules ([c2ae6ab](https://github.com/TimVanOnckelen/famlin/commit/c2ae6ab116d1658b5146616f6bdbfb4cf2a93ffc))
* deeper Immich integration — shared albums, new-asset detection, people mapping ([ebf3232](https://github.com/TimVanOnckelen/famlin/commit/ebf323274f3bd19c8f0f1058620c3f98235107a4))
* enhance authentication and error handling in admin and comment routes; improve media token management ([973ac3b](https://github.com/TimVanOnckelen/famlin/commit/973ac3b005d3acec6ac109a25737deed37938035))
* enhance development experience with nodemon integration for automatic restarts and Prisma migrations ([444f32d](https://github.com/TimVanOnckelen/famlin/commit/444f32df3151585713e8ba13e2000a19a1faeda2))
* enhance documentation with API reference improvements ([6409b7b](https://github.com/TimVanOnckelen/famlin/commit/6409b7bd46908591aaf1f9db7dc58503ceed5e6c))
* enhance expo-notifications mock with additional response handling ([2822427](https://github.com/TimVanOnckelen/famlin/commit/2822427c32b0517b434b6ade08d02955bdb27660))
* enhance notification messages with excerpts and reactions; add new media notification templates ([fa8ca70](https://github.com/TimVanOnckelen/famlin/commit/fa8ca70334a7380a24bda1d997cf106804a86548))
* enhance testing setup with dedicated test database and docker support ([4f41002](https://github.com/TimVanOnckelen/famlin/commit/4f41002c51fe6409d6be4134c36a277ed0feabe0))
* implement first-run admin setup process ([bdc66bf](https://github.com/TimVanOnckelen/famlin/commit/bdc66bfe196e5f9351d56e6ff85e4bbc61cd56fe))
* implement first-run admin setup process ([782801a](https://github.com/TimVanOnckelen/famlin/commit/782801accbc124aed19d5814f0b914b46004a980))
* implement MediaPickerModal component for selecting media from albums ([c6ef5b8](https://github.com/TimVanOnckelen/famlin/commit/c6ef5b851be21c0584a354c29b04f793f8ac9022))
* implement server settings layout with navigation and card components ([52aa6be](https://github.com/TimVanOnckelen/famlin/commit/52aa6bed0c450f4d7fd57721e9c55de06241618c))
* initialize web application with React, Vite, and TypeScript ([ddfbf31](https://github.com/TimVanOnckelen/famlin/commit/ddfbf3175a97d973b98c59a7a81032f8ff62a054))
* integrate People Mapping section into Server Settings and enhance UI with new styles ([89835fd](https://github.com/TimVanOnckelen/famlin/commit/89835fd0d5a832c5329a463867b2816c370b7bac))
* optimize session management and enhance media token revocation; update nodemailer version ([6049900](https://github.com/TimVanOnckelen/famlin/commit/6049900d5594145a679893bc6d13b036328a5e24))
* remove eas.json configuration file ([264f437](https://github.com/TimVanOnckelen/famlin/commit/264f43754561e1273303bbc1ab9b03fd50bc6a80))
* show mapped people as tags on posts in the feed ([3decf14](https://github.com/TimVanOnckelen/famlin/commit/3decf14512383c86700d3d4ebcb865452add662e))
* tag people on photos owned by other Immich users in shared albums ([eed8fd8](https://github.com/TimVanOnckelen/famlin/commit/eed8fd8fb165e657feb63f0df4099a0cd11b1ec0))
* update CI configuration for test database and add early stage warning to website ([ccfbbd6](https://github.com/TimVanOnckelen/famlin/commit/ccfbbd66a76a57c1fc653052f9a2d99da002bc53))
* update CI workflows for Docker image publishing and add production build configurations ([824aa05](https://github.com/TimVanOnckelen/famlin/commit/824aa058beb875ae8d0814084491cd98386e4f02))
* update post reaction from 'LIKE' to 'LOVE' across components and tests ([69870e4](https://github.com/TimVanOnckelen/famlin/commit/69870e4edbd722212d037f6c11a79dafbc306350))


### Bug Fixes

* Add Podfile properties for Expo configuration and Hermes engine ([d310168](https://github.com/TimVanOnckelen/famlin/commit/d31016834cca8f12d767a80f9a63a20e6a77c6b4))
* Add Podfile properties for Expo configuration and Hermes engine ([3a80354](https://github.com/TimVanOnckelen/famlin/commit/3a803548eeff1fa21b3dc54cc502cfd01fcf323f))
* align Expo config version with app metadata ([f3310a3](https://github.com/TimVanOnckelen/famlin/commit/f3310a3d8e7293641e4aef19796f0c43caa23cc5))
* **api-client:** skip build when dependencies are missing ([de1e14e](https://github.com/TimVanOnckelen/famlin/commit/de1e14ee1742aa14b2cc05ab395db36d8baaa3b2))
* coerce Immich search page cursor to a number and log failed Immich requests ([5a1b2af](https://github.com/TimVanOnckelen/famlin/commit/5a1b2af7c5962c52ff2ed8003f55b8ae081dd1d3))
* **dockerignore:** ensure api-client dist is included for build stability ([7a9667d](https://github.com/TimVanOnckelen/famlin/commit/7a9667ddb3e98c0d457967d900a57d4ea3f7688f))
* **mobile:** include api-client dist for EAS builds ([43de6df](https://github.com/TimVanOnckelen/famlin/commit/43de6df59e38140a374d58e4f44c3aa37151c412))
* **mobile:** surface specific OIDC mobile-callback errors ([1473acf](https://github.com/TimVanOnckelen/famlin/commit/1473acf38c31b9317243db3ace309065306ae778))
* remove hardcoded Expo fallback versions ([2d5946d](https://github.com/TimVanOnckelen/famlin/commit/2d5946d5ae453240ac7afadbb7e7c26a897c6438))
* remove redundant environment key from production submit configuration ([c495e15](https://github.com/TimVanOnckelen/famlin/commit/c495e156141e8d747bc39fc341c3bedd089e5834))
* remove redundant service account key path from production configuration ([aab6eaa](https://github.com/TimVanOnckelen/famlin/commit/aab6eaa280c6a9d7e85b606591f3b8a8d08a0467))
* update image URLs and admin credentials in seed-screenshots; add temp directory to .gitignore ([adefad5](https://github.com/TimVanOnckelen/famlin/commit/adefad5e8475aea1d367db75bc428c3c1299d6f1))
* update like response structure in tests for consistency ([fc8498c](https://github.com/TimVanOnckelen/famlin/commit/fc8498c1241bfd0a437608bacdd7f81d837a0f69))

## [0.1.11](https://github.com/TimVanOnckelen/famlin/compare/v0.1.10...v0.1.11) (2026-07-10)


### Features

* add API breaking-change check to CI workflow and update contributing guidelines for breaking changes ([1c879d5](https://github.com/TimVanOnckelen/famlin/commit/1c879d55d3cca2e9b3704a1f8cb98b2a8ac18d2a))
* add comment attachment functionality with photo/video support ([ebcd619](https://github.com/TimVanOnckelen/famlin/commit/ebcd61956ae9665496722d41f7dbec3b50b52a3c))
* add photo and photo timeline schemas, implement PhotosScreen and PhotosPage components ([e82bcd0](https://github.com/TimVanOnckelen/famlin/commit/e82bcd016cc2e5d53d10e9301420c7f6ccd9c145))
* add ShimmerImage component for improved loading experience and update image rendering across components ([e89c207](https://github.com/TimVanOnckelen/famlin/commit/e89c20710f68bbe51888f5c798d6b8fd568c6983))
* deeper Immich integration — shared albums, new-asset detection, people mapping ([ebf3232](https://github.com/TimVanOnckelen/famlin/commit/ebf323274f3bd19c8f0f1058620c3f98235107a4))
* enhance development experience with nodemon integration for automatic restarts and Prisma migrations ([444f32d](https://github.com/TimVanOnckelen/famlin/commit/444f32df3151585713e8ba13e2000a19a1faeda2))
* implement server settings layout with navigation and card components ([52aa6be](https://github.com/TimVanOnckelen/famlin/commit/52aa6bed0c450f4d7fd57721e9c55de06241618c))
* integrate People Mapping section into Server Settings and enhance UI with new styles ([89835fd](https://github.com/TimVanOnckelen/famlin/commit/89835fd0d5a832c5329a463867b2816c370b7bac))
* show mapped people as tags on posts in the feed ([3decf14](https://github.com/TimVanOnckelen/famlin/commit/3decf14512383c86700d3d4ebcb865452add662e))
* tag people on photos owned by other Immich users in shared albums ([eed8fd8](https://github.com/TimVanOnckelen/famlin/commit/eed8fd8fb165e657feb63f0df4099a0cd11b1ec0))


### Bug Fixes

* coerce Immich search page cursor to a number and log failed Immich requests ([5a1b2af](https://github.com/TimVanOnckelen/famlin/commit/5a1b2af7c5962c52ff2ed8003f55b8ae081dd1d3))
* remove redundant environment key from production submit configuration ([c495e15](https://github.com/TimVanOnckelen/famlin/commit/c495e156141e8d747bc39fc341c3bedd089e5834))
* remove redundant service account key path from production configuration ([aab6eaa](https://github.com/TimVanOnckelen/famlin/commit/aab6eaa280c6a9d7e85b606591f3b8a8d08a0467))

## [0.1.10](https://github.com/TimVanOnckelen/famlin/compare/v0.1.9...v0.1.10) (2026-07-10)


### Features

* add end-to-end tests for local-folder media provider ([b5dd878](https://github.com/TimVanOnckelen/famlin/commit/b5dd8783ea48bfbf5cc00ffc6c82df4cf2d45dd3))
* implement MediaPickerModal component for selecting media from albums ([c6ef5b8](https://github.com/TimVanOnckelen/famlin/commit/c6ef5b851be21c0584a354c29b04f793f8ac9022))


### Bug Fixes

* **api-client:** skip build when dependencies are missing ([de1e14e](https://github.com/TimVanOnckelen/famlin/commit/de1e14ee1742aa14b2cc05ab395db36d8baaa3b2))
* **dockerignore:** ensure api-client dist is included for build stability ([7a9667d](https://github.com/TimVanOnckelen/famlin/commit/7a9667ddb3e98c0d457967d900a57d4ea3f7688f))
* **mobile:** surface specific OIDC mobile-callback errors ([1473acf](https://github.com/TimVanOnckelen/famlin/commit/1473acf38c31b9317243db3ace309065306ae778))

## [0.1.9](https://github.com/TimVanOnckelen/famlin/compare/v0.1.8...v0.1.9) (2026-07-08)


### Bug Fixes

* **mobile:** include api-client dist for EAS builds ([43de6df](https://github.com/TimVanOnckelen/famlin/commit/43de6df59e38140a374d58e4f44c3aa37151c412))

## [0.1.8](https://github.com/TimVanOnckelen/famlin/compare/v0.1.7...v0.1.8) (2026-07-08)


### Features

* add group labeling to posts in multi-group feeds ([cf42a0d](https://github.com/TimVanOnckelen/famlin/commit/cf42a0d2f154489c55b677f2516cd16a00ddebf0))
* add personal access tokens (API tokens) functionality ([b34e33c](https://github.com/TimVanOnckelen/famlin/commit/b34e33c28144d003df0a9b1629ce773162f5e8ec))
* add profile page with avatar upload and notification preferences ([aacc40a](https://github.com/TimVanOnckelen/famlin/commit/aacc40a45245004035c5ffa2551b25f49f95ac33))
* enhance documentation with API reference improvements ([6409b7b](https://github.com/TimVanOnckelen/famlin/commit/6409b7bd46908591aaf1f9db7dc58503ceed5e6c))
* initialize web application with React, Vite, and TypeScript ([ddfbf31](https://github.com/TimVanOnckelen/famlin/commit/ddfbf3175a97d973b98c59a7a81032f8ff62a054))
* update post reaction from 'LIKE' to 'LOVE' across components and tests ([69870e4](https://github.com/TimVanOnckelen/famlin/commit/69870e4edbd722212d037f6c11a79dafbc306350))

## [0.1.7](https://github.com/TimVanOnckelen/famlin/compare/v0.1.6...v0.1.7) (2026-07-05)


### Features

* add Immich service integration for album and asset management ([d6ef9f2](https://github.com/TimVanOnckelen/famlin/commit/d6ef9f22031af9b089457ef11732686600133587))
* add Immich service integration for album and asset management ([b3fc2b6](https://github.com/TimVanOnckelen/famlin/commit/b3fc2b6a3fad61bf0491e60e6b98c898aca26620))


### Bug Fixes

* align Expo config version with app metadata ([f3310a3](https://github.com/TimVanOnckelen/famlin/commit/f3310a3d8e7293641e4aef19796f0c43caa23cc5))
* remove hardcoded Expo fallback versions ([2d5946d](https://github.com/TimVanOnckelen/famlin/commit/2d5946d5ae453240ac7afadbb7e7c26a897c6438))

## [0.1.6](https://github.com/TimVanOnckelen/famlin/compare/v0.1.5...v0.1.6) (2026-07-03)


### Features

* add reaction system to posts and comments ([5055b27](https://github.com/TimVanOnckelen/famlin/commit/5055b27826a74631776efd91c0148decf0b75bfa))
* add testing framework and implement tests for various modules ([c2ae6ab](https://github.com/TimVanOnckelen/famlin/commit/c2ae6ab116d1658b5146616f6bdbfb4cf2a93ffc))
* enhance expo-notifications mock with additional response handling ([2822427](https://github.com/TimVanOnckelen/famlin/commit/2822427c32b0517b434b6ade08d02955bdb27660))
* enhance notification messages with excerpts and reactions; add new media notification templates ([fa8ca70](https://github.com/TimVanOnckelen/famlin/commit/fa8ca70334a7380a24bda1d997cf106804a86548))
* optimize session management and enhance media token revocation; update nodemailer version ([6049900](https://github.com/TimVanOnckelen/famlin/commit/6049900d5594145a679893bc6d13b036328a5e24))


### Bug Fixes

* update image URLs and admin credentials in seed-screenshots; add temp directory to .gitignore ([adefad5](https://github.com/TimVanOnckelen/famlin/commit/adefad5e8475aea1d367db75bc428c3c1299d6f1))
* update like response structure in tests for consistency ([fc8498c](https://github.com/TimVanOnckelen/famlin/commit/fc8498c1241bfd0a437608bacdd7f81d837a0f69))

## [0.1.5](https://github.com/TimVanOnckelen/famlin/compare/v0.1.4...v0.1.5) (2026-07-02)


### Features

* enhance authentication and error handling in admin and comment routes; improve media token management ([973ac3b](https://github.com/TimVanOnckelen/famlin/commit/973ac3b005d3acec6ac109a25737deed37938035))

## [0.1.4](https://github.com/TimVanOnckelen/famlin/compare/v0.1.3...v0.1.4) (2026-07-02)


### Features

* implement first-run admin setup process ([bdc66bf](https://github.com/TimVanOnckelen/famlin/commit/bdc66bfe196e5f9351d56e6ff85e4bbc61cd56fe))
* implement first-run admin setup process ([782801a](https://github.com/TimVanOnckelen/famlin/commit/782801accbc124aed19d5814f0b914b46004a980))

## [0.1.3](https://github.com/TimVanOnckelen/famlin/compare/v0.1.2...v0.1.3) (2026-07-02)


### Bug Fixes

* Add Podfile properties for Expo configuration and Hermes engine ([d310168](https://github.com/TimVanOnckelen/famlin/commit/d31016834cca8f12d767a80f9a63a20e6a77c6b4))
* Add Podfile properties for Expo configuration and Hermes engine ([3a80354](https://github.com/TimVanOnckelen/famlin/commit/3a803548eeff1fa21b3dc54cc502cfd01fcf323f))

## [0.1.2](https://github.com/TimVanOnckelen/famlin/compare/v0.1.1...v0.1.2) (2026-07-02)


### Features

* remove eas.json configuration file ([264f437](https://github.com/TimVanOnckelen/famlin/commit/264f43754561e1273303bbc1ab9b03fd50bc6a80))
* update CI workflows for Docker image publishing and add production build configurations ([824aa05](https://github.com/TimVanOnckelen/famlin/commit/824aa058beb875ae8d0814084491cd98386e4f02))

## [0.1.1](https://github.com/TimVanOnckelen/famlin/compare/v0.1.0...v0.1.1) (2026-07-02)


### Features

* add admin panel with user and group management, settings, and localization support ([e33d914](https://github.com/TimVanOnckelen/famlin/commit/e33d9142e53f022428538f06df055670a488f936))
* add Notifications, PostDetail, and Profile screens with state management ([f79377e](https://github.com/TimVanOnckelen/famlin/commit/f79377e47f4b19d5d6d91fe3ad7dbddcbee8c74f))
* enhance testing setup with dedicated test database and docker support ([4f41002](https://github.com/TimVanOnckelen/famlin/commit/4f41002c51fe6409d6be4134c36a277ed0feabe0))
* update CI configuration for test database and add early stage warning to website ([ccfbbd6](https://github.com/TimVanOnckelen/famlin/commit/ccfbbd66a76a57c1fc653052f9a2d99da002bc53))
