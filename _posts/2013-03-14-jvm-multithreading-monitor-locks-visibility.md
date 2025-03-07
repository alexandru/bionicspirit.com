---
title: "JVM Multithreading: Monitor Locks and Visibility"
tags:
  - Languages
  - FP
  - Scala
  - Java
  - Multithreading
  - Concurrency
generate_toc: true
image: /assets/media/articles/ferrari.jpg
---

<p class="intro">
  Multithreading is a pain to deal with. While interviewing developers,
  I noticed that surprisingly many don't have knowledge about this topic
  and I can't blame them really. However, in this day and age, for some
  problem domains building highly-concurrent architectures may be
  paramount to the success of demanding projects. As you'll see, there
  are many high level solutions, but I personally prefer to learn with a
  bottom up approach, starting from the basic and unsafe primitives, as
  understanding the problem is always the first step to real solutions.
</p>

This is (hopefully) the start of a series of articles giving an
overview of the primitives and tools available on top of the JVM for
solving concurrency-related problems, with code given in Scala and
Java, starting from standard synchronization techniques, going through
low-level primitives and non-blocking algorithms based on
compare-and-set, up to high-level tools, such as Futures/Promises,
actors and optimistic locking with shared transactional memory.

<!-- read more -->

## The Problem of Atomicity

Over 100,000 people can watch the same soccer game from the same
stadium, at the same time. Those same 100,000 people cannot all take a
dump in the same bathroom at the same time. Writing data to a central
location requires an agreed-upon protocol for establishing who's
allowed to write and when.

Most of our concurrency-related problems come from our usage of
*mutable data and data-structures*, as both reading and writing are
problematic. When updating a mutable data-structure, the data can get
into an inconsistent state, so threads that are doing the reading can
end-up with garbage. When multiple threads are updating the same
data-structure, the result can be far worse as it can lead to
irrecoverable data corruption.

To solve the problem, you want updates to seem *instantaneous* from
other threads, with no in-between intermediary and inconsistent
state. A piece of code is considered *atomic* if it seems
instantaneous to other threads.

Consider implementing a basic stack. Below is one example in which
many things can go wrong, pointing out a few gotchas off the top of
my head.

([See here for the Java version](https://github.com/alexandru/multithreading-tutorial/blob/master/src/main/java/JavaSynchronize1.java))

```scala
/**
  * Class representing nodes in a simple linked list.
  *
  * NOTES:
  *
  * 1. considering this class is used in the context of a stack, we
  *    never need to add or remove from the middle, so there's no
  *    reason for why this shouldn't be immutable
  *
  * 2. leaving this class public exposes the internal implementation
  *    of our stack
  *
  */
class Node {
  var value: Any = null
  var next: Node = null
}

/**
  * Totally unsafe, totally screwed implementation of a stack.
  */
class Stack {
  /**
    * Gotcha: leaving our head public, means other threads can mess
    * with the internal state of our stack, even more so because our
    * Node class is mutable.
    */
  var head: Node = null

  def isEmpty = head == null

  def push(value: Any) {
    val node = new Node
    node.value = value
    node.next = this.head
    // Gotcha: by the time we assign the new head, another thread may
    // have changed it already
    this.head = node
  }

  def pop() = {
    if (!isEmpty) {
      // Gotchas:
      //
      // 1. by the time the following is executed the `head` can
      //    already be null
      //
      // 2. two or more threads may read the same `head` and thus
      // receive the same value on pop()
      val node = this.head

      // 1. again, the `head` can already be different, so the
      //    following assignment may lose data
      // 2. the new value may not be visible from other threads
      this.head = node.next
      node.value
    } else {
      null
    }
  }
}
```

The standard way to fix this, as preferred by Java developers, is to
use the `synchronize` keyword on all the Stack's methods. You've seen
this before, right?

```java
public synchronized boolean isEmpty() {
  return this.head == null;
}
```

The `synchronized` keyword creates a *monitor lock* (also called an
*intrinsic lock*) on the implicit `this`. So in case of an instance,
it creates a monitor on that instance. In the case of Java's `static`
methods, it creates a monitor on the class object. It's important to
keep this in mind, because `synchronized` is not some magical tool
that solves every problem you may have and I like that Scala doesn't
have such a keyword ;-)

A *monitor lock* is guaranteed to be acquired by only a single thread
at the same time. Other threads that try acquiring it in the process
are blocked until the lock is free again.

Lets improve the above using the following:

1. the Monitor pattern (monitor locks on `this`)
2. encapsulation of internal mutable state
3. `Option[T]` instead of nulls (Guava's `Optional<T>` for the Java
   version), because that's how I roll
4. immutable nodes for our internal linked-list

([See here for the Java version](https://github.com/alexandru/multithreading-tutorial/blob/master/src/main/java/JavaSynchronize2.java))

```scala
/**
  * Better (mutable) stack implementation.
  *
  * For type-safety, changed the interface to take a type parameter.
  */
class Stack[T] {
  /**
    *
    * Changes:
    * 1. to prevent implementation leaks, nodes in our linked-list
    *    have to be private, including the Node class
    * 2. Node instances are now immutable (always prefer immutable
    *    data structures)
    * 3. never use nulls, prefer proper initialization and Option[T]
    */
  private[this] case class Node(
    value: Option[T],
    next: Option[Node]
  )

  /**
    * The head of our stack.
    *
    * Because the Node class is private, if you make this field
    * public, then the compiler will trigger a compilation error
    */
  private[this] var head: Option[Node] = None

  def isEmpty =
    this.synchronized {
      head.isEmpty
    }

  def push(value: T): Stack[T] = {
    // entering monitor lock
    this.synchronized {
      head = Some(Node(
        value = Option(value),
        next = head
      ))
      this
    }
  }

  def pop(): Option[T] = {
    // Entering monitor lock
    //
    // Note that `isEmpty` is also synchronized, but monitor locks
    // are reentrant so a lock can be acquired multiple times by the
    // same thread.
    this.synchronized {
      if (!isEmpty) {
        val node = head.get
        head = node.next
        node.value
      }
      else
        None
    }
  }
}
```

That's better. Not perfect though, as Stacks are the easiest immutable
data-structures to implement ... so how about not using any locks at
all? (that's for another article)

### The Big Problem with Locks

Take these 2 stacks:

```scala
val stack1 = new Stack.push("World").push("Hello")
val stack2 = new Stack
```

Question: is the following thread safe?

```scala
while (!stack1.isEmpty)
  stack2.push( stack1.pop )
```

Answer: No. Given that:

1. `A` is thread safe
2. `B` is thread safe

Then using `A + B` is NOT thread safe, unless you make it so by using
an external lock that protects both at all times.

Code that's thread-safe through synchronization based on locks is
**not composable**.

<h2 id="visibility">The Problem of Visibility</h2>

When speaking of multithreading, the most obvious problem is the
inconsistency of shared mutable state when being changed and read by
multiple threads at the same time. However the problem is actually
twofold and the *atomicity* of code that changes mutable state is not
your only problem.

Take this piece of code Scala code (
[see here for the Java version](https://github.com/alexandru/multithreading-tutorial/blob/master/src/main/java/JavaVisibility1.java)):

```scala
var result = "Not Initialized"
var isDone = false

val producer = new Thread(new Runnable {
  def run() {
    result = "Hello, World!"
    isDone = true
  }
})

val consumer = new Thread(new Runnable {
  def run() {
    // loops until isDone is true
    while (!isDone) {}
    println(result)
  }
})

consumer.start()
producer.start()
consumer.join()
```

**Question:** What does the above print?

1. *Hello, World!*
2. *Not initialized*
3. Nothing, goes into an infinite loop
4. All of the above

The answer may surprise some of you. It's actually number 4, all of
the above. To make matters worse, you can't predict what happens, as
it depends on the CPU architecture you have, on the number of cores,
on who made the VM, on what other apps you have running, on whether
the laptop is plugged in or not, on planetary alignments and so on.

So what can happen?

1. On most desktops today, most of the time (as in >50%) it will
  behave as expected, which kind of sucks really, because it's far
  better to have a fast and loud failure than one with subtle effects
  that may or may not manifest when you're testing the app.
2. The JVM doesn't guarantee that the instructions are executed in the
  given order. Amongst others, the VM may decide that those
  instructions are independent of each other and may reverse their
  order for things like better cache locality, or because processors
  are pretty smart about executing multi-cycles instructions, being
  able for example to start subsequent instructions before the
  previous ones are finished. So it's pretty common for the compiler
  to reorder instructions such that longer instructions are executed
  before shorter ones. The processor itself may decide to execute
  instructions out of order, even if the VM/compiler is issuing the
  instructions in the right order. From the point of view of the
  `producer` thread, the result is the same as if the instructions
  are executed in the given order, but you can't rely on it when
  viewing the results from outside threads.
3. The new value for `isDone` could be cached somewhere (like in a
  processor register) and the `consumer` thread may never see this
  new value. On my desktop in more than 1 out of 10 cases this little
  example goes into an infinite loop.

### Happens-Before Relationships and Memory Barriers

As I was saying at point 2 above, in addition to cached values, you
can also have reordered instructions. Say that you've got the
following calls:

```scala
statementA;
statementB;
```

From the point of view of the thread executing these 2 statements, the
result of `statementA` is available to `statementB`. We call this a
*[happens-before](http://en.wikipedia.org/wiki/Happened-before)*
relationship between the two statements. So from the point of view of
the executing thread, the result is always the same as if these 2
statements are executing in order, even if these statements are
executed in fact out of order.

Outside of the executing thread, this *happens-before* relationship is
not guaranteed. The result of `statementB` could be visible to other
threads, while the result of `statementA` could be made visible later
or *never*.

In our example, to ensure that `isDone` is written after `result` and
to ensure the visibility for outside threads for both, you need to
create what is called a
*[memory barrier](http://en.wikipedia.org/wiki/Memory_barrier)*.

The standard way of doing this is (again) through a *monitor lock*
acquired on a certain object.

A synchronization block guarantees two things:

* all the writes that happened on other threads on variables, by using
  the monitor `X`, are visible to our current thread if it acquired
  *the same monitor* `X`
* at the end of the synchronization block, a memory barrier is created
  and changes made to variables inside that block will be visible to
  other threads that *use the same monitor*

To fix our problem with monitor locks, here's the Scala version (
[see here for the Java version](https://github.com/alexandru/multithreading-tutorial/blob/master/src/main/java/JavaVisibility2.java)):

```scala
var result = "Not Initialized"
var isDone = false
val lock = new AnyRef

val consumer = new Thread(new Runnable {
  def run() {
    var continueLooping = true

    while (continueLooping)
      lock.synchronized {
        continueLooping = !isDone
      }

    println(result)
  }
})

val producer = new Thread(new Runnable {
  def run() {
    lock.synchronized {
      result = "Hello, World!"
      isDone = true
    } // <-- memory barrier
  }
})

consumer.start()
producer.start()
consumer.join()
```

There is one big gotcha here. The JVM only guarantees *visibility* and
*happens-before relationships* only if the threads involved in
reading/writing to our variables are synchronized with the same
monitor lock. This gotcha could happen for a bunch of reasons, for
instance the JVM does escape-analysis and it can get rid of locks
completely if it decides a lock isn't used concurrently by multiple
threads.

### Volatiles

For this particular example, you actually don't need a lock at
all. All you need is a `volatile`:

```scala
@volatile
var isDone = false
```

Or in Java:

```java
volatile boolean isDone = false;
```

A write to a `volatile` also creates a memory-barrier. If you need
memory barriers, then a write to a volatile on the JVM creates a
*full-fence*. This guarantees not only the visibility of `isDone`, but
it also guarantees the visibility of all other variables written prior
to it by the same thread, like `result` in our example.

Volatiles are useful sometimes in non-blocking algorithms. But even
with the strong guarantee of the created memory-barrier, for most
purposes where you need volatiles, you'll end up using atomic
instances from the `java.util.concurrent.atomic` package, like
[AtomicReference](http://docs.oracle.com/javase/1.5.0/docs/api/java/util/concurrent/atomic/AtomicReference.html)
or
[AtomicInteger](http://docs.oracle.com/javase/1.5.0/docs/api/java/util/concurrent/atomic/AtomicInteger.html).

That's because you need **compare and set** for non-blocking
algorithms, an atomic operation that's optimized on most CPUs today
that you can't do with plain volatiles.

But that's a topic for another article.

## Further Reading

Checkout the following:

* **[JSR 133 (Java Memory Model) FAQ](http://www.cs.umd.edu/~pugh/java/memoryModel/jsr-133-faq.html)**
* **[Java Concurrency in Practice](http://www.amazon.com/gp/product/0321349601/ref=as_li_ss_tl?ie=UTF8&camp=1789&creative=390957&creativeASIN=0321349601&linkCode=as2&tag=bionicspirit-20)**
   (affiliate Amazon link)
