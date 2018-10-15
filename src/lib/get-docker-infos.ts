import * as Fetch from "node-fetch";
import * as ssh from "node-ssh";
import { Configuration } from 'dockerproxy-commons';
import { textToObject } from "./console-to-object";

export class DockerAPI {
    private sshInstance: Promise<ssh.default> = null;

    public stop(): Promise<void> {
        if (this.sshInstance) {
            return this.sshInstance.then((connection) => {
                connection.dispose();
                this.sshInstance = null;
            });
        }
        return Promise.resolve();
    }
    public getNodes(): Promise<INodeInfos[]> {
        return this.request("/nodes").then((response) => {
            return response.json();
        });
    }

    public getServices(): Promise<IServiceInfos[]> {
        return this.request("/services").then((response) => {
            return response.json();
        });
    }

    public getNodePs(id: string): Promise<INodePsEntry[]> {
        if (!this.sshInstance) {
            this.sshInstance = Configuration.INSTANCE.getConfig().then((config) => {
                return new Promise<ssh.default>((resolve, reject) => {
                    const connection = new ssh.default();
                    connection.connect({
                        host: config.swarmHost,
                        password: config.swarmUsername,
                        port: config.swarmPortSSH,
                        username: config.swarmPassword,
                    }).then(() => {
                        resolve(connection);
                    }, (e) => {
                        reject(e);
                    });
                });
            });
        }
        try {
            return this.sshInstance.then((connection: ssh.default) => {
                return connection.exec("docker", ["node", "ps", id]).then((results) => {
                    return results;
                });
            }).then((output: string) => {
                return textToObject<INodePsEntry>(["ID", "NAME", "IMAGE", "NODE", "DESIRED STATE", "CURRENT STATE", "ERROR", "PORTS"], output)
            });
        } catch (e) {
            return Promise.reject(e);
        }
    }

    private request(url: string): Promise<Fetch.Response> {
        return Configuration.INSTANCE.getConfig().then((config) => {
            return Fetch.default("http://" + config.swarmHost + ":" + config.swarmPortHTTP + url);
        });
    }
}

export interface INodeInfos {
    ID: string;
    Version: {
        Index: number;
    };
    CreatedAt: string;
    UpdatedAt: string;
    Spec: {
        Labels: {};
        Role: "worker" | "manager";
        Availability: "active" | "inactive"
    };
    Description: {
        Hostname: string,
        Platform: {
            Architecture: string;
            OS: string;
        },
        Resources: {
            NanoCPUs: number;
            MemoryBytes: number;
        },
        Engine: {
            EngineVersion: string;
            Plugins: Array<{
                Type: string;
                Name: string;
            }>;
        },
        TLSInfo: {
            TrustRoot: string;
            CertIssuerSubject: string;
            CertIssuerPublicKey: string;
        };
    };
    Status: {
        State: string;
        Addr: string;
    };
}

export interface INodePsEntry {
    ID: string;
    NAME: string;
    IMAGE: string;
    NODE: string;
    "DESIRED STATE": string;
    "CURRENT STATE": string;
    ERROR: string;
    PORTS: string;
}

export interface IServiceInfos {
    ID: string;
    Version: {
        Index: number;
    };
    CreatedAt: string;
    UpdatedAt: string;
    Spec: {
        Name: string;
        Labels: { [key: string]: string };
        TaskTemplate: {
            ContainerSpec: {
                Image: string;
                Labels: { [key: string]: string };
                Env: string[];
                Privileges: {
                    CredentialSpec: any;
                    SELinuxContext: any;
                };
                Isolation: string;
            };
            Resources: {},
            RestartPolicy: {
                Condition: string;
                MaxAttempts: number;
            };
            Placement: {
                Platforms: Array<{
                    Architecture: string;
                    OS: string;
                }>;
            };
            Networks: Array<{
                Target: string;
                Aliases: string[];
            }>;
            ForceUpdate: number;
            Runtime: string;
        };
        Mode: {
            Replicated: {
                Replicas: number;
            };
        };
        EndpointSpec: {
            Mode: string;
            Ports: Array<{
                Protocol: string;
                TargetPort: number;
                PublishedPort: number;
                PublishMode: string;
            }>;
        };
    };
    PreviousSpec: {
        Name: string,
        Labels: { [key: string]: string };
        TaskTemplate: {
            ContainerSpec: {
                Image: string;
                Labels: { [key: string]: string };
                Env: string[];
                Privileges: {
                    CredentialSpec: any;
                    SELinuxContext: any;
                },
                Isolation: string;
            };
            Resources: {};
            RestartPolicy: {
                Condition: string;
                MaxAttempts: number;
            };
            Placement: {
                Platforms: Array<{
                    Architecture: string;
                    OS: string;
                }>;
            };
            Networks: Array<{
                Target: string;
                Aliases: string[];
            }>;
            ForceUpdate: number;
            Runtime: string;
        };
        Mode: {
            Replicated: {
                Replicas: number;
            };
        };
        EndpointSpec: {
            Mode: string;
            Ports: Array<{
                Protocol: string;
                TargetPort: number;
                PublishedPort: number;
                PublishMode: string;
            }>;
        };
    };
    Endpoint: {
        Spec: {
            Mode: string;
            Ports: Array<{
                Protocol: string;
                TargetPort: number;
                PublishedPort: number;
                PublishMode: string;
            }>;
        },
        Ports: Array<{
            Protocol: string;
            TargetPort: number;
            PublishedPort: number;
            PublishMode: string;
        }>;
        VirtualIPs: Array<{
            NetworkID: string;
            Addr: string;
        }>;
    };
}
