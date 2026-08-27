CREATE TABLE IF NOT EXISTS `accounts` (
  `id` varchar(255) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `type` varchar(255) NOT NULL,
  `provider` varchar(255) NOT NULL,
  `providerAccountId` varchar(255) NOT NULL,
  `refresh_token` text,
  `access_token` text,
  `expires_at` int,
  `token_type` varchar(255),
  `scope` varchar(255),
  `id_token` text,
  `session_state` varchar(255),
  PRIMARY KEY (`id`),
  UNIQUE KEY `provider_providerAccountId` (`provider`, `providerAccountId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `session` (
  `id` varchar(255) NOT NULL,
  `sessionToken` varchar(255) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `expires` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sessionToken` (`sessionToken`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `verification_token` (
  `identifier` varchar(255) NOT NULL,
  `token` varchar(255) NOT NULL,
  `expires` datetime NOT NULL,
  PRIMARY KEY (`identifier`, `token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user` (
  `id` varchar(255) NOT NULL,
  `name` varchar(255),
  `email` varchar(255),
  `emailVerified` datetime,
  `image` varchar(255),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; 