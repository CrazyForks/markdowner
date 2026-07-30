use std::sync::Arc;

use serde::Serialize;

use super::AiError;

pub const OPENROUTER_KEYCHAIN_SERVICE: &str = "dev.chann.markdowner.openrouter";
pub const OPENROUTER_KEYCHAIN_ACCOUNT: &str = "default";

pub trait CredentialStore: Send + Sync {
    fn get(&self, service: &str, account: &str) -> Result<Option<Vec<u8>>, AiError>;
    fn set(&self, service: &str, account: &str, secret: &[u8]) -> Result<(), AiError>;
    fn delete(&self, service: &str, account: &str) -> Result<(), AiError>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiKeyStatus {
    pub configured: bool,
    pub masked_label: Option<String>,
}

#[derive(Clone)]
pub struct KeychainService {
    store: Arc<dyn CredentialStore>,
}

impl KeychainService {
    pub fn new(store: impl CredentialStore + 'static) -> Self {
        Self {
            store: Arc::new(store),
        }
    }

    pub fn system() -> Self {
        Self::new(SystemCredentialStore)
    }

    pub fn status(&self) -> Result<AiKeyStatus, AiError> {
        let Some(secret) = self
            .store
            .get(OPENROUTER_KEYCHAIN_SERVICE, OPENROUTER_KEYCHAIN_ACCOUNT)?
        else {
            return Ok(AiKeyStatus {
                configured: false,
                masked_label: None,
            });
        };
        let secret = String::from_utf8(secret).map_err(|_| {
            AiError::new(
                "keychain_corrupt",
                "The stored OpenRouter credential is not valid UTF-8.",
            )
        })?;
        Ok(AiKeyStatus {
            configured: true,
            masked_label: Some(mask_key(&secret)),
        })
    }

    pub fn save(&self, secret: &str) -> Result<AiKeyStatus, AiError> {
        let secret = secret.trim();
        if secret.is_empty() || secret.len() > 512 || secret.chars().any(char::is_control) {
            return Err(AiError::new(
                "invalid_key",
                "Enter a non-empty OpenRouter API key.",
            ));
        }
        self.store.set(
            OPENROUTER_KEYCHAIN_SERVICE,
            OPENROUTER_KEYCHAIN_ACCOUNT,
            secret.as_bytes(),
        )?;
        Ok(AiKeyStatus {
            configured: true,
            masked_label: Some(mask_key(secret)),
        })
    }

    pub fn delete(&self) -> Result<AiKeyStatus, AiError> {
        self.store
            .delete(OPENROUTER_KEYCHAIN_SERVICE, OPENROUTER_KEYCHAIN_ACCOUNT)?;
        Ok(AiKeyStatus {
            configured: false,
            masked_label: None,
        })
    }

    pub(crate) fn read_secret(&self) -> Result<String, AiError> {
        let secret = self
            .store
            .get(OPENROUTER_KEYCHAIN_SERVICE, OPENROUTER_KEYCHAIN_ACCOUNT)?
            .ok_or_else(|| {
                AiError::new(
                    "key_not_configured",
                    "Connect OpenRouter before running an AI task.",
                )
            })?;
        String::from_utf8(secret).map_err(|_| {
            AiError::new(
                "keychain_corrupt",
                "The stored OpenRouter credential is not valid UTF-8.",
            )
        })
    }
}

fn mask_key(secret: &str) -> String {
    let suffix = secret
        .chars()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("••••{suffix}")
}

#[derive(Clone, Copy)]
pub struct SystemCredentialStore;

#[cfg(target_os = "macos")]
impl CredentialStore for SystemCredentialStore {
    fn get(&self, service: &str, account: &str) -> Result<Option<Vec<u8>>, AiError> {
        use security_framework::passwords::{PasswordOptions, generic_password};

        match generic_password(PasswordOptions::new_generic_password(service, account)) {
            Ok(secret) => Ok(Some(secret)),
            Err(error) if error.code() == -25_300 => Ok(None),
            Err(error) => Err(keychain_error(error)),
        }
    }

    fn set(&self, service: &str, account: &str, secret: &[u8]) -> Result<(), AiError> {
        use security_framework::passwords::set_generic_password;

        set_generic_password(service, account, secret).map_err(keychain_error)
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), AiError> {
        use security_framework::passwords::delete_generic_password;

        match delete_generic_password(service, account) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == -25_300 => Ok(()),
            Err(error) => Err(keychain_error(error)),
        }
    }
}

#[cfg(target_os = "macos")]
fn keychain_error(error: security_framework::base::Error) -> AiError {
    AiError::new(
        "keychain_error",
        format!("macOS Keychain could not complete the request ({error})."),
    )
}

#[cfg(not(target_os = "macos"))]
impl CredentialStore for SystemCredentialStore {
    fn get(&self, _service: &str, _account: &str) -> Result<Option<Vec<u8>>, AiError> {
        Err(AiError::new(
            "unsupported_platform",
            "Secure OpenRouter credential storage is currently available on macOS.",
        ))
    }

    fn set(&self, _service: &str, _account: &str, _secret: &[u8]) -> Result<(), AiError> {
        Err(AiError::new(
            "unsupported_platform",
            "Secure OpenRouter credential storage is currently available on macOS.",
        ))
    }

    fn delete(&self, _service: &str, _account: &str) -> Result<(), AiError> {
        Err(AiError::new(
            "unsupported_platform",
            "Secure OpenRouter credential storage is currently available on macOS.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };

    use super::{AiError, CredentialStore, KeychainService};

    type CredentialMap = HashMap<(String, String), Vec<u8>>;

    #[derive(Clone, Default)]
    struct FakeCredentialStore {
        values: Arc<Mutex<CredentialMap>>,
    }

    impl CredentialStore for FakeCredentialStore {
        fn get(&self, service: &str, account: &str) -> Result<Option<Vec<u8>>, AiError> {
            Ok(self
                .values
                .lock()
                .unwrap()
                .get(&(service.to_string(), account.to_string()))
                .cloned())
        }

        fn set(&self, service: &str, account: &str, secret: &[u8]) -> Result<(), AiError> {
            self.values
                .lock()
                .unwrap()
                .insert((service.to_string(), account.to_string()), secret.to_vec());
            Ok(())
        }

        fn delete(&self, service: &str, account: &str) -> Result<(), AiError> {
            self.values
                .lock()
                .unwrap()
                .remove(&(service.to_string(), account.to_string()));
            Ok(())
        }
    }

    #[test]
    fn key_lifecycle_never_returns_secret_to_command_result() {
        let service = KeychainService::new(FakeCredentialStore::default());
        let saved = service.save("sk-or-v1-secret").unwrap();

        assert!(saved.configured);
        assert_eq!(saved.masked_label.as_deref(), Some("••••secret"));
        assert!(
            !serde_json::to_string(&saved)
                .unwrap()
                .contains("sk-or-v1-secret")
        );
        assert_eq!(service.read_secret().unwrap(), "sk-or-v1-secret");
        assert!(service.status().unwrap().configured);

        service.delete().unwrap();
        assert!(!service.status().unwrap().configured);
    }

    #[test]
    fn empty_or_whitespace_credentials_are_rejected() {
        let service = KeychainService::new(FakeCredentialStore::default());

        let error = service.save(" \n\t ").unwrap_err();

        assert_eq!(error.code, "invalid_key");
        assert!(!service.status().unwrap().configured);
    }
}
