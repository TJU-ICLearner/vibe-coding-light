use objc::runtime::{Class, Object};
use objc::{msg_send, sel, sel_impl};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[link(name = "ServiceManagement", kind = "framework")]
extern "C" {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoginStatus {
    Disabled,
    Enabled,
    RequiresApproval,
    NotFound,
}

fn map_status(value: isize) -> Result<LoginStatus, String> {
    match value {
        0 => Ok(LoginStatus::Disabled),
        1 => Ok(LoginStatus::Enabled),
        2 => Ok(LoginStatus::RequiresApproval),
        3 => Ok(LoginStatus::NotFound),
        _ => Err("Unknown macOS login item status".into()),
    }
}

fn agent_path() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or("Home directory unavailable")?
        .join("Library/LaunchAgents/com.cuihuapeng.code-light.login.plist"))
}

fn xml_escape(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '&' => "&amp;".into(),
            '<' => "&lt;".into(),
            '>' => "&gt;".into(),
            '"' => "&quot;".into(),
            '\'' => "&apos;".into(),
            _ => character.to_string(),
        })
        .collect()
}

fn launch_agent_plist(executable: &str) -> String {
    format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>Label</key><string>com.cuihuapeng.code-light.login</string><key>ProgramArguments</key><array><string>{}</string></array><key>RunAtLoad</key><true/></dict></plist>\n", xml_escape(executable))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AgentFileStatus {
    Missing,
    Current,
    Stale,
    Foreign,
}

fn classify_agent_file(saved: Option<&str>, executable: &str) -> AgentFileStatus {
    let Some(saved) = saved else {
        return AgentFileStatus::Missing;
    };
    if saved == launch_agent_plist(executable) {
        return AgentFileStatus::Current;
    }
    let template = launch_agent_plist("__EXECUTABLE__");
    let (prefix, suffix) = template.split_once("__EXECUTABLE__").unwrap();
    if saved
        .strip_prefix(prefix)
        .and_then(|body| body.strip_suffix(suffix))
        .is_some_and(|body| !body.is_empty() && !body.contains('<'))
    {
        AgentFileStatus::Stale
    } else {
        AgentFileStatus::Foreign
    }
}

fn launch_agent_status() -> Result<AgentFileStatus, String> {
    let saved = match fs::read_to_string(agent_path()?) {
        Ok(saved) => Some(saved),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    Ok(classify_agent_file(
        saved.as_deref(),
        &executable.to_string_lossy(),
    ))
}

fn remove_owned_launch_agent() -> Result<(), String> {
    if matches!(
        launch_agent_status()?,
        AgentFileStatus::Current | AgentFileStatus::Stale
    ) {
        fs::remove_file(agent_path()?).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn write_launch_agent() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let bundle = executable
        .ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .ok_or("Move Vibe Coding Light.app to Applications before enabling launch at login")?;
    let home_apps = dirs::home_dir()
        .ok_or("Home directory unavailable")?
        .join("Applications");
    if !bundle.starts_with(Path::new("/Applications")) && !bundle.starts_with(&home_apps) {
        return Err(
            "Move Vibe Coding Light.app to Applications before enabling launch at login".into(),
        );
    }
    write_launch_agent_file(&agent_path()?, &executable)
}

fn write_launch_agent_file(path: &Path, executable: &Path) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid login item path")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temp.write_all(launch_agent_plist(&executable.to_string_lossy()).as_bytes())
        .map_err(|error| error.to_string())?;
    temp.flush().map_err(|error| error.to_string())?;
    use std::os::unix::fs::PermissionsExt;
    temp.as_file()
        .set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    temp.persist(path).map_err(|error| error.to_string())?;
    Ok(())
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

fn native_status() -> Result<LoginStatus, String> {
    let service = main_app_service()?;
    let value: isize = unsafe { msg_send![service, status] };
    map_status(value)
}

pub fn status() -> Result<LoginStatus, String> {
    let native = native_status().unwrap_or(LoginStatus::NotFound);
    if native == LoginStatus::Enabled {
        remove_owned_launch_agent()?;
        return Ok(LoginStatus::Enabled);
    }
    match launch_agent_status()? {
        AgentFileStatus::Current => Ok(LoginStatus::Enabled),
        AgentFileStatus::Stale => {
            if write_launch_agent().is_ok() {
                Ok(LoginStatus::Enabled)
            } else {
                remove_owned_launch_agent()?;
                Ok(native)
            }
        }
        AgentFileStatus::Missing | AgentFileStatus::Foreign => Ok(native),
    }
}

pub fn set_enabled(enabled: bool) -> Result<LoginStatus, String> {
    let agent = launch_agent_status()?;
    if enabled && agent == AgentFileStatus::Current {
        return Ok(LoginStatus::Enabled);
    }
    let native = native_status().unwrap_or(LoginStatus::NotFound);
    if enabled && native == LoginStatus::NotFound {
        if agent == AgentFileStatus::Foreign {
            return Err("Login item file belongs to another app".into());
        }
        write_launch_agent()?;
        return Ok(LoginStatus::Enabled);
    }
    if !enabled {
        remove_owned_launch_agent()?;
        if native == LoginStatus::Disabled || native == LoginStatus::NotFound {
            return Ok(LoginStatus::Disabled);
        }
    }
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
    let result = status()?;
    if result == LoginStatus::NotFound {
        Err("Login item registration was not accepted by macOS".into())
    } else {
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_status_remains_actionable_and_launch_agent_xml_is_escaped() {
        assert_eq!(map_status(3).unwrap(), LoginStatus::NotFound);
        let xml = launch_agent_plist("/Applications/A&B.app/Contents/MacOS/a<file>");
        assert!(xml.contains("A&amp;B.app"));
        assert!(xml.contains("a&lt;file&gt;"));
    }

    #[test]
    fn launch_agent_file_is_written_atomically_for_the_current_user() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Library/LaunchAgents/test.plist");
        let executable =
            Path::new("/Applications/Vibe Coding Light.app/Contents/MacOS/vibe-coding-light");
        write_launch_agent_file(&path, executable).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            launch_agent_plist(&executable.to_string_lossy())
        );
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o077, 0);
    }

    #[test]
    fn stale_agent_is_identified_without_claiming_foreign_files() {
        let current = "/Applications/Vibe Coding Light.app/Contents/MacOS/vibe-coding-light";
        let old = "/Applications/Old Vibe Coding Light.app/Contents/MacOS/vibe-coding-light";
        assert_eq!(
            classify_agent_file(Some(&launch_agent_plist(current)), current),
            AgentFileStatus::Current
        );
        assert_eq!(
            classify_agent_file(Some(&launch_agent_plist(old)), current),
            AgentFileStatus::Stale
        );
        assert_eq!(
            classify_agent_file(
                Some("<plist><dict><key>Label</key><string>other</string></dict></plist>"),
                current
            ),
            AgentFileStatus::Foreign
        );
    }

    #[test]
    fn main_app_service_accessor_matches_objective_c_api() {
        if Class::get("SMAppService").is_some() {
            assert!(main_app_service().is_ok());
        }
    }
}
