use std::path::Path;
use std::{fs, io::Write};

pub fn sync(path: &Path, enabled: bool, now_secs: u64) -> Result<(), String> {
    if !enabled {
        return match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        };
    }
    let parent = path.parent().ok_or("Detail marker path has no parent")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    writeln!(temp, "{} {now_secs}", std::process::id()).map_err(|error| error.to_string())?;
    temp.flush().map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    temp.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_marker_exists_only_while_detail_pushes_are_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("detail-capture");
        sync(&marker, false, 100).unwrap();
        assert!(!marker.exists());
        sync(&marker, true, 101).unwrap();
        let contents = std::fs::read_to_string(&marker).unwrap();
        assert_eq!(contents, format!("{} 101\n", std::process::id()));
        sync(&marker, false, 102).unwrap();
        assert!(!marker.exists());
    }
}
