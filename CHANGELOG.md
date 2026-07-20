# Changelog

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
