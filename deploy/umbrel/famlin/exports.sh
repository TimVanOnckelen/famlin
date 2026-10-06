export APP_FAMLIN_DB_PASSWORD="$(derive_entropy "${app_entropy_identifier}-postgres-password")"
export APP_FAMLIN_JWT_SECRET="$(derive_entropy "${app_entropy_identifier}-jwt-secret")"
