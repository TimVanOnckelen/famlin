import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebar: SidebarsConfig = {
  apisidebar: [
    {
      type: "doc",
      id: "api-reference/famlin-api",
    },
    {
      type: "category",
      label: "Account",
      link: {
        type: "doc",
        id: "api-reference/account",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/login",
          label: "Log in with email and password",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/get-me",
          label: "Get the authenticated user",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/update-me",
          label: "Update profile and notification preferences",
          className: "api-method patch",
        },
        {
          type: "doc",
          id: "api-reference/change-password",
          label: "Change your password",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/get-server-info",
          label: "Get the server version",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-notification-config",
          label: "Which notification channels the server has enabled",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "API tokens",
      link: {
        type: "doc",
        id: "api-reference/api-tokens",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/list-api-tokens",
          label: "List your API tokens",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/create-api-token",
          label: "Create an API token",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/revoke-api-token",
          label: "Revoke an API token",
          className: "api-method delete",
        },
      ],
    },
    {
      type: "category",
      label: "Groups",
      link: {
        type: "doc",
        id: "api-reference/groups",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/list-groups",
          label: "List your groups",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-group",
          label: "Get one group",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/list-group-members",
          label: "List a group's members",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Posts",
      link: {
        type: "doc",
        id: "api-reference/posts",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/list-posts",
          label: "List posts (your feed)",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/create-post",
          label: "Create a post",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/search-posts",
          label: "Search posts in a group",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-on-this-day",
          label: "Posts from this day in earlier years",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-post",
          label: "Get one post",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/update-post",
          label: "Edit your own post",
          className: "api-method patch",
        },
        {
          type: "doc",
          id: "api-reference/delete-post",
          label: "Delete a post",
          className: "api-method delete",
        },
      ],
    },
    {
      type: "category",
      label: "Comments",
      link: {
        type: "doc",
        id: "api-reference/comments",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/list-comments",
          label: "List a post's comments",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/create-comment",
          label: "Comment on a post",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/update-comment",
          label: "Edit your own comment",
          className: "api-method patch",
        },
        {
          type: "doc",
          id: "api-reference/delete-comment",
          label: "Delete a comment",
          className: "api-method delete",
        },
      ],
    },
    {
      type: "category",
      label: "Reactions",
      link: {
        type: "doc",
        id: "api-reference/reactions",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/react-to-post",
          label: "React to a post",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/react-to-comment",
          label: "React to a comment",
          className: "api-method post",
        },
      ],
    },
    {
      type: "category",
      label: "Favorites",
      link: {
        type: "doc",
        id: "api-reference/favorites",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/toggle-favorite",
          label: "Toggle a favorite",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/list-favorites",
          label: "List your favorited posts",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Notifications",
      link: {
        type: "doc",
        id: "api-reference/notifications",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/list-notifications",
          label: "List your notifications",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-unread-notification-count",
          label: "Count unread notifications",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/update-notification",
          label: "Mark a notification read or unread",
          className: "api-method patch",
        },
        {
          type: "doc",
          id: "api-reference/mark-all-notifications-read",
          label: "Mark all notifications read",
          className: "api-method post",
        },
      ],
    },
    {
      type: "category",
      label: "Uploads & media",
      link: {
        type: "doc",
        id: "api-reference/uploads-media",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/upload-files",
          label: "Upload photos or videos",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/get-media-token",
          label: "Get a media token",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-uploaded-file",
          label: "Download an uploaded file",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Media",
      link: {
        type: "doc",
        id: "api-reference/media",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/list-group-media-albums",
          label: "List a group's linked albums (all media sources)",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/list-media-album-assets",
          label: "List an album's assets",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-media-asset",
          label: "Stream a media asset rendition",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Immich",
      link: {
        type: "doc",
        id: "api-reference/immich",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/list-group-immich-albums",
          label: "List a group's linked Immich albums",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/list-immich-album-assets",
          label: "List an album's assets",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-immich-asset",
          label: "Stream an Immich asset rendition",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "Push tokens",
      link: {
        type: "doc",
        id: "api-reference/push-tokens",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/register-push-token",
          label: "Register an Expo push token",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/unregister-push-token",
          label: "Unregister an Expo push token",
          className: "api-method delete",
        },
      ],
    },
    {
      type: "category",
      label: "Invites",
      link: {
        type: "doc",
        id: "api-reference/invites",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/preview-invite",
          label: "Preview an invite",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/register-via-invite",
          label: "Create an account from an invite",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/accept-invite",
          label: "Join a group with an existing account",
          className: "api-method post",
        },
      ],
    },
    {
      type: "category",
      label: "Schemas",
      items: [
        {
          type: "doc",
          id: "api-reference/schemas/error",
          label: "Error",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/success",
          label: "Success",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/reactiontype",
          label: "ReactionType",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/reactioncounts",
          label: "ReactionCounts",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/reactionresult",
          label: "ReactionResult",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/usersummary",
          label: "UserSummary",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/user",
          label: "User",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/group",
          label: "Group",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/groupmember",
          label: "GroupMember",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/post",
          label: "Post",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/postspage",
          label: "PostsPage",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/comment",
          label: "Comment",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/apitoken",
          label: "ApiToken",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/createdapitoken",
          label: "CreatedApiToken",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/notification",
          label: "Notification",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/mediaalbum",
          label: "MediaAlbum",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/mediaasset",
          label: "MediaAsset",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/immichalbum",
          label: "ImmichAlbum",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/immichasset",
          label: "ImmichAsset",
          className: "schema",
        },
        {
          type: "doc",
          id: "api-reference/schemas/invitepreview",
          label: "InvitePreview",
          className: "schema",
        },
      ],
    },
  ],
};

export default sidebar.apisidebar;
