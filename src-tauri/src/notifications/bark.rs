use serde::Serialize;
use std::error::Error as StdError;
use std::time::Duration;

const BARK_URL: &str = "https://api.day.app/push";

#[derive(Clone, Debug, Serialize)]
pub struct PushPayload {
    pub title: String,
    pub body: String,
    pub group: String,
}

impl PushPayload {
    pub fn test() -> Self {
        Self {
            title: "Vibe Coding Light".into(),
            body: "Test notification".into(),
            group: "Vibe Coding Light".into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BarkError {
    Unsent,
    Ambiguous,
    Rejected,
}

pub struct BarkClient {
    client: reqwest::blocking::Client,
    url: String,
}

impl BarkClient {
    pub fn new() -> Result<Self, BarkError> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| BarkError::Unsent)?;
        Ok(Self {
            client,
            url: BARK_URL.into(),
        })
    }

    #[cfg(test)]
    fn for_test(url: String, timeout: Duration) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(timeout)
            .no_proxy()
            .build()
            .unwrap();
        Self { client, url }
    }

    pub fn send(&self, key: &str, payload: &PushPayload) -> Result<(), BarkError> {
        if key.is_empty() {
            return Err(BarkError::Unsent);
        }
        let body = serde_json::json!({"device_key":key,"title":payload.title,"body":payload.body,"group":payload.group});
        for attempt in 0..2 {
            match self.client.post(&self.url).json(&body).send() {
                Ok(response) => {
                    if !response.status().is_success() {
                        return Err(BarkError::Rejected);
                    }
                    let value: serde_json::Value = response.json().map_err(|error| {
                        #[cfg(test)]
                        eprintln!("Bark test response parse error: {error:?}");
                        BarkError::Ambiguous
                    })?;
                    if value["code"].as_i64() == Some(200) {
                        return Ok(());
                    }
                    return Err(BarkError::Rejected);
                }
                Err(error) if definitely_unsent(&error) => {
                    if attempt == 0 {
                        std::thread::sleep(Duration::from_millis(50));
                        continue;
                    }
                    return Err(BarkError::Unsent);
                }
                Err(error) => {
                    #[cfg(test)]
                    eprintln!(
                        "Bark test transport error: {error:?}; connect={}, timeout={}",
                        error.is_connect(),
                        error.is_timeout()
                    );
                    return Err(BarkError::Ambiguous);
                }
            }
        }
        Err(BarkError::Unsent)
    }
}

fn definitely_unsent(error: &reqwest::Error) -> bool {
    if error.is_connect() {
        return true;
    }
    let mut cause: Option<&(dyn StdError + 'static)> = error.source();
    while let Some(current) = cause {
        if let Some(io) = current.downcast_ref::<std::io::Error>() {
            if matches!(
                io.kind(),
                std::io::ErrorKind::ConnectionRefused
                    | std::io::ErrorKind::NotConnected
                    | std::io::ErrorKind::AddrNotAvailable
            ) {
                return true;
            }
        }
        cause = current.source();
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn local_transport_receives_json_with_key_only_in_body() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/push", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut raw = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = socket.read(&mut buf).unwrap();
                raw.extend_from_slice(&buf[..n]);
                if raw.windows(4).any(|x| x == b"\r\n\r\n") {
                    break;
                }
            }
            let header_end = raw.windows(4).position(|x| x == b"\r\n\r\n").unwrap() + 4;
            let header = String::from_utf8_lossy(&raw[..header_end]).into_owned();
            let length: usize = header
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .and_then(|x| x.trim().parse().ok())
                })
                .unwrap();
            while raw.len() - header_end < length {
                let n = socket.read(&mut buf).unwrap();
                raw.extend_from_slice(&buf[..n]);
            }
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 12\r\n\r\n{\"code\":200}").unwrap();
            (
                header,
                serde_json::from_slice::<serde_json::Value>(&raw[header_end..header_end + length])
                    .unwrap(),
            )
        });
        let client = BarkClient::for_test(url, Duration::from_secs(1));
        client
            .send(
                "secret-key",
                &PushPayload {
                    title: "Vibe Coding Light".into(),
                    body: "Claude · 本轮回复完成".into(),
                    group: "Vibe Coding Light".into(),
                },
            )
            .unwrap();
        let (header, body) = server.join().unwrap();
        assert!(header.starts_with("POST /push HTTP/1.1"));
        assert!(!header.contains("secret-key"));
        assert_eq!(body["device_key"], "secret-key");
        assert_eq!(body["body"], "Claude · 本轮回复完成");
    }

    #[test]
    fn connection_refusal_is_definitely_unsent() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/push", listener.local_addr().unwrap());
        drop(listener);
        let client = BarkClient::for_test(url, Duration::from_millis(100));
        let result = client.send("key", &PushPayload::test());
        assert!(matches!(result, Err(BarkError::Unsent)), "{result:?}");
    }

    #[test]
    fn timeout_after_request_does_not_retry() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/push", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let start = std::time::Instant::now();
            let mut accepted = 0;
            while start.elapsed() < Duration::from_millis(180) {
                if let Ok((_socket, _)) = listener.accept() {
                    accepted += 1;
                }
                thread::sleep(Duration::from_millis(5));
            }
            accepted
        });
        let client = BarkClient::for_test(url, Duration::from_millis(50));
        assert!(matches!(
            client.send("key", &PushPayload::test()),
            Err(BarkError::Ambiguous)
        ));
        assert_eq!(server.join().unwrap(), 1);
    }

    #[test]
    fn bad_response_is_local_diagnostic_without_key() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/push", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
        });
        let client = BarkClient::for_test(url, Duration::from_secs(1));
        let err = client.send("secret-key", &PushPayload::test()).unwrap_err();
        assert!(!format!("{err:?}").contains("secret-key"));
        server.join().unwrap();
    }
}
