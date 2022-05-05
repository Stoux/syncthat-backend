
// Over-engineered stuff. Probably not needed.
export class ReactiveVar<T> {
    val: T;
    callbacks: ((val: T) => void)[];

    constructor(val: T) {
        this.val = val;
        this.callbacks = [];
    }

    public subscribe(callback: (val: T) => void): void {
        this.callbacks.push(callback);
    }

    public unsubscribe(callback: (val: T) => void): void {
        this.callbacks = this.callbacks.filter(c => c !== callback);
    }

    public set(val: T = undefined): void {
        this.val = val;
        this.trigger();
    }

    public trigger(): void {
        this.callbacks.forEach(callback => callback(this.val));
    }


    public get(): T {
        return this.val;
    }

    public modify(modify: (val: T) => T|void): void {
        const val = modify(this.val);
        this.set(val ? val : this.val);
    }

}