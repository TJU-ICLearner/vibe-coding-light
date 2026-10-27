use objc::runtime::{Class, Object};
use objc::{msg_send, sel, sel_impl};

#[link(name = "ServiceManagement", kind = "framework")]
extern "C" {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoginStatus {
    Disabled,
    Enabled,
    RequiresApproval,
}

fn main_app_service() -> Result<*mut Object, String> {
    let class = Class::get("SMAppService").ok_or("Login items require macOS 13 or later")?;
    let service: *mut Object = unsafe { msg_send![class, mainAppService] };
    if service.is_null() {
        Err("Main app login service unavailable".into())
    } else {
        Ok(service)
    }
}

pub fn status() -> Result<LoginStatus, String> {
    let service = main_app_service()?;
    let value: isize = unsafe { msg_send![service, status] };
    match value {
        0 => Ok(LoginStatus::Disabled),
        1 => Ok(LoginStatus::Enabled),
        2 => Ok(LoginStatus::RequiresApproval),
        _ => Err("Login item unavailable for this app bundle".into()),
    }
}

pub fn set_enabled(enabled: bool) -> Result<LoginStatus, String> {
    let service = main_app_service()?;
    let mut error: *mut Object = std::ptr::null_mut();
    let success: bool = if enabled {
        unsafe { msg_send![service, registerAndReturnError: &mut error] }
    } else {
        unsafe { msg_send![service, unregisterAndReturnError: &mut error] }
    };
    if !success {
        return Err("macOS could not change the login item".into());
    }
    status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_app_service_accessor_matches_objective_c_api() {
        if Class::get("SMAppService").is_some() {
            assert!(main_app_service().is_ok());
        }
    }
}
